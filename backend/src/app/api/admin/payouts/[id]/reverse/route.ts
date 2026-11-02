import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { reversePayout } from '@/lib/services/payouts';
import { payoutReasonSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/admin/payouts/{id}/reverse`
 *
 * A clawback after the money left: the transfer landed with the wrong person, or the parcels in
 * that window turned out to be fraudulent. Reversing decrements the shop's lifetime sales
 * counters that `SENT` incremented, so the stall's public numbers go back to what was real.
 *
 * Reversal does not recover the cash — that is a collections conversation — it corrects the
 * ledger so the next payout is not computed on top of money that has to come back.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const admin = await requireAdmin();
    const { id } = paramsSchema.parse(context.params);
    const { reason } = await readJson(request, payoutReasonSchema);

    return jsonBody(await reversePayout(id, admin.id, reason), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
