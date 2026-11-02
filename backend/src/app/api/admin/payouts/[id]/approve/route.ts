import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { approvePayout } from '@/lib/services/payouts';
import { payoutNoteSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/admin/payouts/{id}/approve`
 *
 * Approval is a check, not a payment: it confirms the KYC is approved, the payout account is
 * verified and the window has not already been paid. The MoMo credentials on this deployment are
 * scoped to the *collection* product — disbursement is a different API with a different contract
 * — so the actual transfer is made in the operator portal and booked back with `/sent`.
 *
 * Guessing at a payout API we do not have credentials for would either fail silently or, worse,
 * move real money twice.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const admin = await requireAdmin();
    const { id } = paramsSchema.parse(context.params);
    const { note } = await readJson(request, payoutNoteSchema);

    return jsonBody(await approvePayout(id, admin.id, note), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
