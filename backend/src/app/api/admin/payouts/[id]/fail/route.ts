import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { failPayout } from '@/lib/services/payouts';
import { payoutReasonSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/admin/payouts/{id}/fail`
 *
 * For a transfer that never left the portal — a wrong MoMo number, a KYC hold, a bank rejection.
 * The window is released back to the seller so they can request it again; nothing was paid, so
 * nothing is reversed. A payout already `SENT` cannot be failed here: that is a `REVERSED` with
 * its own audit action, because money actually moved.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const admin = await requireAdmin();
    const { id } = paramsSchema.parse(context.params);
    const { reason } = await readJson(request, payoutReasonSchema);

    return jsonBody(await failPayout(id, admin.id, reason), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
