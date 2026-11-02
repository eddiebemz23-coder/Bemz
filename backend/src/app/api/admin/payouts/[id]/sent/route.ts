import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { markPayoutSent } from '@/lib/services/payouts';
import { payoutSentSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/admin/payouts/{id}/sent`
 *
 * Books the transfer the operator already made in the MoMo/bank portal. `providerReference` is
 * the operator's own transaction code and is unique across payouts: a second request carrying a
 * reference already booked is refused rather than silently double-counting a seller's sales.
 *
 * The shop's lifetime `totalSalesCount` / `totalSalesMinor` only move on this call — a request
 * that was approved but never sent is not a sale, and a dashboard that says otherwise is a
 * liability in a dispute.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const admin = await requireAdmin();
    const { id } = paramsSchema.parse(context.params);
    const { providerReference } = await readJson(request, payoutSentSchema);

    return jsonBody(await markPayoutSent(id, admin.id, providerReference), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
