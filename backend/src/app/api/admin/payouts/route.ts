import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { adminPayoutQueue } from '@/lib/services/payouts';
import { payoutListQuerySchema } from '@/lib/validation/commerce';

/**
 * `GET /api/admin/payouts`
 *
 * Finance's worklist. The default filter is anything still open (`REQUESTED` or `APPROVED`);
 * pass `status` for a paid or reversed history. `openValueMinor` on the response is the number
 * the platform is currently committed to moving, which is what the treasury gets asked about.
 *
 * Amounts here are always the ones the ledger computed when the seller requested — a queue
 * cannot edit a figure, only approve or refuse it.
 */
export const GET = withRoute(async (request: Request) => {
  await requireAdmin();
  const query = parseQuery(request, payoutListQuerySchema);

  return jsonBody(
    await adminPayoutQueue({
      ...(query.status ? { status: query.status } : {}),
      page: query.page,
      perPage: query.perPage,
    }),
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
