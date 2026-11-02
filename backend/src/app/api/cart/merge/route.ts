import { withRoute, jsonBody } from '@/lib/http';
import { guestCartCookie, guestTokenFromRequest, requireUser } from '@/lib/auth/guards';
import { mergeGuestCart, readCart } from '@/lib/services/cart';

/**
 * `POST /api/cart/merge`
 *
 * Called once by the client right after a guest signs in. The guest basket is folded into the
 * account's own basket — quantities summed and capped at live stock — and the guest cart row
 * is closed, so one phone never keeps two parallel baskets alive.
 *
 * The signed-in caller may still be browsing from the same device that held the guest basket,
 * so the token is taken from the cookie or the `x-cart-token` header rather than the body:
 * nothing here trusts a client-supplied cart id.
 */
export const POST = withRoute(async (request: Request) => {
  const user = await requireUser();
  const guestToken = guestTokenFromRequest(request);

  if (!guestToken) {
    return jsonBody(await readCart({ userId: user.id }), 200, {
      'cache-control': 'private, no-store',
      'set-cookie': guestCartCookie('', 0),
    });
  }

  const view = await mergeGuestCart({ guestToken, userId: user.id });
  return jsonBody(view, 200, {
    'cache-control': 'private, no-store',
    'set-cookie': guestCartCookie('', 0),
  });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
