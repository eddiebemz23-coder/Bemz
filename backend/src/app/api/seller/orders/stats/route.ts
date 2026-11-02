import { withRoute, jsonBody, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { sellerOrderStats } from '@/lib/services/orders';

/**
 * `GET /api/seller/orders/stats`
 *
 * The badge counts for the seller's queue, plus the two numbers that decide whether the shop
 * is worth restocking: what has sold and what the platform took as commission on those
 * delivered parcels. Commission is shown here because it is the seller's own figure — it is
 * never exposed on a buyer-facing quote.
 *
 * Addressed to "my shop" from the session, so a seller cannot poll a rival's sales.
 */
export const GET = withRoute(async () => {
  const { shop } = await requireSellerShop();
  const stats = await sellerOrderStats(shop.id);

  return jsonBody(
    {
      shopId: shop.id,
      statuses: stats.statuses,
      grossSalesMinor: stats.grossSalesMinor,
      commissionMinor: stats.commissionMinor,
      needsPacking: stats.statuses.CONFIRMED?.count ?? 0,
      needsDispatch: stats.statuses.PACKED?.count ?? 0,
      inTransit: stats.statuses.OUT_FOR_DELIVERY?.count ?? 0,
      awaitingPayment: stats.statuses.AWAITING_PAYMENT?.count ?? 0,
      awaitingConfirmation: stats.statuses.AWAITING_CONFIRMATION?.count ?? 0,
    },
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
