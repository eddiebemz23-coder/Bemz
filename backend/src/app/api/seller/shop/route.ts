import { withRoute, jsonBody, readJson, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { sellerShopOverview, updateShop } from '@/lib/services/shops';
import { updateShopSchema } from '@/lib/validation/catalog';

/**
 * `GET /api/seller/shop`
 *
 * The dashboard header: listings, orders by status, stock alerts, KYC state and the payout
 * account. Read-only aggregates are computed server-side so the dashboard and the seller's
 * own spreadsheet agree.
 */
export const GET = withRoute(async () => {
  const { shop } = await requireSellerShop();
  return jsonBody(await sellerShopOverview(shop.id), 200, privateCache());
});

/**
 * `PATCH /api/seller/shop`
 *
 * Partial by design — the profile editor saves as you type. `country` is not editable: the
 * market fixes the currency, the tax rate and the delivery zone map, so changing it would
 * silently re-price every live listing.
 */
export const PATCH = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const patch = await readJson(request, updateShopSchema);

  return jsonBody(await updateShop(shop, patch), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
