import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { getServerSession } from 'next-auth';
import { authOptions } from './options';
import { prisma, type CurrencyCode, type Shop, type UserRole } from '../prisma';
import { forbidden, unauthorized } from '../http';
import { env } from '../env';

/**
 * Route-level authorisation.
 *
 * The JWT only proves somebody signed in; it does not prove they are still allowed to be
 * here. Every guarded call re-reads the user row so a banned account, a suspended shop or
 * a demoted admin is cut off on the next request instead of at token expiry (30 days).
 */

export type AuthenticatedUser = {
  id: string;
  role: UserRole;
  name: string | null;
  phone: string | null;
  email: string | null;
  preferredCurrency: CurrencyCode;
};

export async function getSessionUser(): Promise<AuthenticatedUser | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      role: true,
      name: true,
      phone: true,
      email: true,
      status: true,
      preferredCurrency: true,
    },
  });

  if (!user) return null;
  if (user.status === 'BANNED' || user.status === 'DELETED') return null;

  return {
    id: user.id,
    role: user.role,
    name: user.name,
    phone: user.phone,
    email: user.email,
    preferredCurrency: user.preferredCurrency,
  };
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getSessionUser();
  if (!user) throw unauthorized('Sign in with your phone number to continue');
  return user;
}

export async function requireRole(...roles: UserRole[]): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    throw forbidden(`This action needs the ${roles.join(' or ')} role`);
  }
  return user;
}

export const requireAdmin = () => requireRole('ADMIN');

/**
 * A seller may act on their own shop; an admin may act on any shop. Returns the shop so
 * callers do not re-query it.
 */
export async function requireShopAccess(shopId: string): Promise<{ user: AuthenticatedUser; shop: Shop }> {
  const user = await requireUser();
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw forbidden('Shop not found');

  if (user.role === 'ADMIN') return { user, shop };
  if (shop.ownerId !== user.id) throw forbidden('That shop belongs to another seller');
  if (shop.status === 'CLOSED') throw forbidden('This shop is closed');

  return { user, shop };
}

/** Same rule, addressed by the public slug used in URLs. */
export async function requireShopAccessBySlug(slug: string) {
  const user = await requireUser();
  const shop = await prisma.shop.findUnique({ where: { slug } });
  if (!shop) throw forbidden('Shop not found');

  if (user.role === 'ADMIN') return { user, shop };
  if (shop.ownerId !== user.id) throw forbidden('That shop belongs to another seller');

  return { user, shop };
}

/**
 * Seller dashboard routes are addressed to "my shop" — never to a shop id in the body or the
 * path. A token belonging to one trader must not be able to write into another's catalog, and
 * this makes that structurally impossible rather than a check somebody has to remember.
 *
 * Ownership, not the `SELLER` role, is the gate: a buyer who opens a shop must be able to use
 * it immediately.
 */
export async function requireSellerShop(): Promise<{ user: AuthenticatedUser; shop: Shop }> {
  const user = await requireUser();
  const shop = await prisma.shop.findFirst({ where: { ownerId: user.id, deletedAt: null } });
  if (!shop) throw forbidden('Open a shop before using the seller tools');
  if (shop.status === 'CLOSED') throw forbidden('This shop is closed — contact support to reopen it');

  return { user, shop };
}

/**
 * The page-side twin of `requireSellerShop`. The API is right to answer 403 when there is no
 * stall, but a dashboard page that throws renders an error screen to a trader who simply has
 * not opened one yet — so the pages ask this and redirect to the opening form instead.
 *
 * It does not filter on `status`: a suspended or closed shop still needs to reach its order queue
 * and its payouts, and the write paths enforce their own status rules.
 */
export async function getSellerShopContext(
  user: AuthenticatedUser,
): Promise<{ user: AuthenticatedUser; shop: Shop } | null> {
  const shop = await prisma.shop.findFirst({ where: { ownerId: user.id, deletedAt: null } });
  return shop ? { user, shop } : null;
}

/**
 * Sellers with no approved KYC cannot list in gated categories (phones, building
 * materials, agro-chemicals) — counterfeit-heavy lines where a bad payout is on us.
 */
export async function assertMayListInCategory(
  shop: Shop,
  params: { requiresKyc: boolean },
): Promise<void> {
  if (!params.requiresKyc) return;
  if (shop.kycStatus === 'APPROVED') return;
  if (shop.kycStatus === 'REJECTED') {
    throw forbidden('Your ID documents were rejected — upload them again before listing here');
  }
  throw forbidden('Upload your national ID to sell in this category');
}

/** A guest basket is keyed by this opaque token, never by the buyer's identity. */
export const CART_COOKIE = 'bemz_cart';
const CART_TOKEN_PATTERN = /^[a-f0-9-]{16,64}$/i;

/** The app sends the token as a header; the browser carries it in a first-party cookie. */
export function guestTokenFromRequest(request: Request): string | null {
  const header = request.headers.get('x-cart-token');
  if (header && CART_TOKEN_PATTERN.test(header)) return header;

  const cookie = request.headers.get('cookie');
  if (cookie) {
    const pair = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${CART_COOKIE}=`));
    const value = pair?.slice(CART_COOKIE.length + 1);
    if (value && CART_TOKEN_PATTERN.test(value)) return value;
  }
  return null;
}

export type BasketHolder = {
  userId: string | null;
  guestToken: string | null;
  /** Set when this request is the first from an unknown device, so the cookie can be issued. */
  mintedGuestToken: string | null;
};

/**
 * Cart routes work for signed-in buyers, for guests with a basket already, and for a brand
 * new visitor on a shared device — the last case needs a token minted before the service is
 * called, because `getOrCreateCart` refuses to guess one.
 */
export async function basketHolderFromRequest(request: Request): Promise<BasketHolder> {
  const user = await getSessionUser();
  const guestToken = guestTokenFromRequest(request);

  if (user) return { userId: user.id, guestToken, mintedGuestToken: null };
  if (guestToken) return { userId: null, guestToken, mintedGuestToken: null };

  const minted = crypto.randomUUID();
  return { userId: null, guestToken: minted, mintedGuestToken: minted };
}

/**
 * `HttpOnly` on purpose: nothing in the page reads this value, the server does, so a
 * cross-site script cannot copy someone's basket off a shared phone at a cyber café.
 */
export function guestCartCookie(token: string, maxAgeSeconds = 30 * 24 * 60 * 60): string {
  return [
    `${CART_COOKIE}=${token}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
    env().NODE_ENV === 'production' ? 'Secure' : null,
  ].filter(Boolean).join('; ');
}

/** Basket responses are never shared-cacheable, and may carry the freshly issued guest cookie. */
export function basketHeaders(holder: BasketHolder): Record<string, string> {
  return {
    'cache-control': 'private, no-store',
    ...(holder.mintedGuestToken ? { 'set-cookie': guestCartCookie(holder.mintedGuestToken) } : {}),
  };
}

function secretsMatch(candidate: string, expected: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  // Different lengths are already a mismatch; `timingSafeEqual` refuses to compare them.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Maintenance endpoints are called by a scheduler that has no browser session, so they accept
 * either a signed-in admin or the `OPS_SWEEP_TOKEN` bearer. When the secret is not configured
 * the route narrows to admin-only rather than opening up — an unset variable must never mean
 * "anyone".
 */
export async function requireOpsAccess(
  request: Request,
): Promise<{ via: 'ADMIN' | 'TOKEN'; userId: string | null }> {
  const header = request.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const configured = env().OPS_SWEEP_TOKEN;

  if (bearer && configured && secretsMatch(bearer, configured)) {
    return { via: 'TOKEN', userId: null };
  }

  const user = await getSessionUser();
  if (user?.role === 'ADMIN') return { via: 'ADMIN', userId: user.id };

  throw unauthorized(
    bearer && !configured
      ? 'OPS_SWEEP_TOKEN is not set on this server — use an admin session'
      : 'This maintenance endpoint needs an admin session or the ops token',
  );
}
