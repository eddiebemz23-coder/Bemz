import { withRoute, jsonBody, privateCache } from '@/lib/http';
import { requireOpsAccess } from '@/lib/auth/guards';
import { expireStaleOrders } from '@/lib/services/orders';
import { expirePayment } from '@/lib/payments';
import { prisma } from '@/lib/prisma';

/**
 * `POST /api/ops/expire-orders`
 *
 * The housekeeping sweep a reservation-based marketplace cannot do without. An abandoned
 * checkout pins stock that a paying buyer then cannot buy, and an unpaid order that never dies
 * is a lie on the seller's dashboard — so this runs on a scheduler (cron, GitHub Actions, a
 * systemd timer) every few minutes.
 *
 * It is idempotent and safe to run twice at once: each release is guarded by the order's own
 * status inside a transaction, so the second worker finds nothing left to do.
 *
 * Reachable by an admin session (the dashboard has a "run the sweep" button) or by the
 * `OPS_SWEEP_TOKEN` bearer for a scheduler that has neither cookies nor a password.
 */
export const POST = withRoute(async (request: Request) => {
  const actor = await requireOpsAccess(request);
  const now = new Date();

  const orders = await expireStaleOrders(now);

  // A payment whose PIN window closed but whose order is still live (a COD order, or one
  // confirmed by a late callback) must not stay PROCESSING forever — it is what the buyer sees
  // as "pending" on their phone.
  const openPayments = await prisma.payment.findMany({
    where: { status: { in: ['INITIATED', 'PENDING_CUSTOMER', 'PROCESSING'] }, expiresAt: { not: null, lt: now } },
    select: { id: true },
    take: 200,
  });
  for (const payment of openPayments) {
    await expirePayment(payment.id);
  }

  return jsonBody(
    {
      ranBy: actor.via,
      at: now,
      ordersExpired: orders.expired,
      variantReservationsReset: orders.resetVariantReservations,
      paymentsExpired: openPayments.length,
      morePending: orders.expired === 200 || openPayments.length === 200,
    },
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
