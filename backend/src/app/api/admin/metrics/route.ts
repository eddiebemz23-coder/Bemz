import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { adminMetrics, adminStaff } from '@/lib/services/moderation';
import { adminMetricsQuerySchema } from '@/lib/validation/commerce';

/**
 * `GET /api/admin/metrics`
 *
 * The morning numbers: GMV against the previous period, orders by status, cancellation rate,
 * refunds, which payment rail the money actually came through, and the top shops and listings.
 *
 * `paidStatuses` excludes `AWAITING_PAYMENT` and cancellations — an unpaid order is not revenue,
 * and a dashboard that counts them is how a marketplace talks itself into growth it does not
 * have. Cash on delivery is included in GMV but separated in the rail mix, because that cash is
 * sitting with a rider rather than in the platform's account.
 *
 * Staff names come along so a reviewer can see who else is on shift before acting on a ban.
 */
export const GET = withRoute(async (request: Request) => {
  await requireAdmin();
  const { days } = parseQuery(request, adminMetricsQuerySchema);

  const [metrics, staff] = await Promise.all([adminMetrics(days), adminStaff()]);
  return jsonBody({ days, metrics, staff }, 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
