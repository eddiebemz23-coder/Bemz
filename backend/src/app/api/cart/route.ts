import { withRoute, jsonBody, readJson, created } from '@/lib/http';
import { basketHeaders, basketHolderFromRequest } from '@/lib/auth/guards';
import { addToCart, clearCart, readCart, setSelectedAll } from '@/lib/services/cart';
import { addToCartSchema, cartSelectAllSchema } from '@/lib/validation/commerce';

/**
 * `GET /api/cart`
 *
 * Reprices on every read rather than serving the stored total, because a basket is a draft:
 * the seller may have changed the price, gone on vacation or sold the last unit since the
 * buyer last looked. `priceChanged` on each line is what the UI turns into a notice.
 */
export const GET = withRoute(async (request: Request) => {
  const holder = await basketHolderFromRequest(request);
  return jsonBody(await readCart(holder), 200, basketHeaders(holder));
});

/**
 * `POST /api/cart`
 *
 * Adding is an upsert on `(cartId, variantId)`, so tapping "+" on a phone that is already in
 * the basket raises the quantity instead of duplicating the line. A first-time visitor gets a
 * guest basket and the `bemz_cart` cookie on this very response.
 */
export const POST = withRoute(async (request: Request) => {
  const holder = await basketHolderFromRequest(request);
  const body = await readJson(request, addToCartSchema);
  return created(await addToCart(holder, body), basketHeaders(holder));
});

/**
 * `PATCH /api/cart` — select or deselect the whole basket.
 *
 * Only the selected lines become orders, which is how a buyer splits one basket across two
 * delivery days without emptying it and re-adding everything.
 */
export const PATCH = withRoute(async (request: Request) => {
  const holder = await basketHolderFromRequest(request);
  const { selected } = await readJson(request, cartSelectAllSchema);
  return jsonBody(await setSelectedAll(holder, selected), 200, basketHeaders(holder));
});

/**
 * `DELETE /api/cart` — empty the basket, keep the coupon slot clear too.
 *
 * The cart row itself survives so the same guest token fills up again without a re-issue.
 */
export const DELETE = withRoute(async (request: Request) => {
  const holder = await basketHolderFromRequest(request);
  return jsonBody(await clearCart(holder), 200, basketHeaders(holder));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
