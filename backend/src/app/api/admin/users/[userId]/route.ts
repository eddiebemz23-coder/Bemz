import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { adminUserCase, setUserStatus } from '@/lib/services/moderation';
import { adminUserStatusSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ userId: z.string().min(1).max(64) });

/**
 * `GET /api/admin/users/{userId}`
 *
 * The support file: account, shops, order counts and the last ten payment attempts. Deliberately
 * no credential material of any kind — a dashboard that can read a hash is a breach waiting for
 * somebody to screenshot it.
 */
export const GET = withRoute<{ userId: string }>(
  async (_request: Request, context: RouteContext<{ userId: string }>) => {
    await requireAdmin();
    const { userId } = paramsSchema.parse(context.params);

    return jsonBody(await adminUserCase(userId), 200, privateCache());
  },
);

/**
 * `PATCH /api/admin/users/{userId}`
 *
 * Suspend or ban, with a reason that lands in the audit log. A ban is a `status`, not a delete:
 * orders, reviews and payouts already sent must keep pointing at a real person for the dispute
 * trail. The JWT is not revoked — it cannot be — which is why every guarded request re-reads the
 * user row and a banned account is cut off on its next call rather than in thirty days.
 *
 * Admin accounts are refused outright. There is no role above ADMIN in this build, so restricting
 * one has to happen in the database with two people watching.
 */
export const PATCH = withRoute<{ userId: string }>(
  async (request: Request, context: RouteContext<{ userId: string }>) => {
    const admin = await requireAdmin();
    const { userId } = paramsSchema.parse(context.params);
    const { status, reason } = await readJson(request, adminUserStatusSchema);

    return jsonBody(await setUserStatus(userId, { status, reason, actorId: admin.id }), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
