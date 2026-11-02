import { withRoute, jsonBody, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { closeShop } from '@/lib/services/shops';

/**
 * `POST /api/seller/shop/close`
 *
 * Closing is a status change, not a delete, and it is refused while parcels are still moving:
 * an order in delivery needs its seller to answer the rider's phone call. Everything the stall
 * ever sold stays readable for the buyer and for support.
 */
export const POST = withRoute(async () => {
  const { shop } = await requireSellerShop();
  return jsonBody(await closeShop(shop), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
