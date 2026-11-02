import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { setShopStatusByAdmin } from '@/lib/services/moderation';
import { adminShopStatusSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ shopId: z.string().min(1).max(64) });

/**
 * `PATCH /api/admin/shops/{shopId}`
 *
 * `ACTIVE` / `SUSPENDED` / `CLOSED`, plus the verified badge. Two rules the service enforces
 * and the route does not duplicate: a shop without approved KYC cannot be activated, and one
 * with parcels still in delivery cannot be closed — a suspension that strands a rider holding
 * somebody's cash is worse than the fraud it stops.
 */
export const PATCH = withRoute<{ shopId: string }>(
  async (request: Request, context: RouteContext<{ shopId: string }>) => {
    const admin = await requireAdmin();
    const { shopId } = paramsSchema.parse(context.params);
    const { status, reason, verified } = await readJson(request, adminShopStatusSchema);

    return jsonBody(await setShopStatusByAdmin(shopId, { status, reason, verified, actorId: admin.id }), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
