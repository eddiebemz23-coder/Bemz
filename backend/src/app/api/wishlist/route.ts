import { withRoute, jsonBody, readJson, created, privateCache } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { addToWishlist, listWishlist } from '@/lib/services/wishlist';
import { wishlistAddSchema } from '@/lib/validation/commerce';

/**
 * `GET /api/wishlist`
 *
 * Saved items keep their live price and stock, so the page can grey out a listing that sold out
 * while it sat in the list — and show the buyer what has dropped since they saved it. That is
 * also why this is never a cached response: it is one person's shelf.
 */
export const GET = withRoute(async () => {
  const user = await requireUser();
  return jsonBody(await listWishlist(user.id), 200, privateCache());
});

/**
 * `POST /api/wishlist`
 *
 * Idempotent by design: a heart button on a slow 3G connection fires twice as often as anyone
 * admits, and a second tap must not double-count the listing's `wishlistsCount` social proof.
 */
export const POST = withRoute(async (request: Request) => {
  const user = await requireUser();
  const { productId } = await readJson(request, wishlistAddSchema);

  return created(await addToWishlist(user.id, productId), privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
