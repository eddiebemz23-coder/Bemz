import { withRoute, jsonBody, readJson } from '@/lib/http';
import { basketHeaders, basketHolderFromRequest } from '@/lib/auth/guards';
import { clearCartCoupon, setCartCoupon } from '@/lib/services/cart';
import { cartCouponSchema } from '@/lib/validation/commerce';

/**
 * `POST /api/cart/coupon`
 *
 * The code is upper-cased by the schema, because every voucher printed for this market is —
 * a buyer typing "bemz10" on a Nokia keyboard should still get the discount. Attaching it to
 * the cart is only a intent: the real eligibility test (minimum spend, per-user cap, which
 * shops are in the basket) runs at quote time inside `quoteBasket`, so a stale coupon can
 * never reach checkout.
 */
export const POST = withRoute(async (request: Request) => {
  const holder = await basketHolderFromRequest(request);
  const { code } = await readJson(request, cartCouponSchema);
  return jsonBody(await setCartCoupon(holder, code), 200, basketHeaders(holder));
});

/** `DELETE /api/cart/coupon` — take the code off the basket without emptying it. */
export const DELETE = withRoute(async (request: Request) => {
  const holder = await basketHolderFromRequest(request);
  return jsonBody(await clearCartCoupon(holder), 200, basketHeaders(holder));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
