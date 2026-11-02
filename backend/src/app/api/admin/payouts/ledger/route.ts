import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { payoutLedger } from '@/lib/services/payouts';
import { payoutLedgerQuerySchema } from '@/lib/validation/commerce';

/**
 * `GET /api/admin/payouts/ledger`
 *
 * The accounting export: every payout booked in a window, in request order, with the shop, the
 * destination account and the operator reference. Because a payout *is* its period, this is also
 * the document that proves two windows never overlapped — which is what an auditor asks for when
 * a seller claims they were paid twice.
 */
export const GET = withRoute(async (request: Request) => {
  await requireAdmin();
  const query = parseQuery(request, payoutLedgerQuerySchema);

  return jsonBody(
    await payoutLedger({
      from: new Date(query.from),
      to: new Date(query.to),
      ...(query.status ? { status: query.status } : {}),
    }),
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
