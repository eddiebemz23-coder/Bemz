import 'server-only';
import { redirect } from 'next/navigation';
import { getSessionUser, getSellerShopContext, type AuthenticatedUser } from './auth/guards';
import type { Shop } from './prisma';

/**
 * The one entry condition every `/seller/**` page shares.
 *
 * Kept out of `guards.ts` because the rule here is a *navigation* rule: an API caller with no
 * stall gets a 403, a trader who opens the dashboard gets walked to the form that opens one.
 * `pathname` is the page they actually asked for, so signing in returns them to it.
 */
export async function sellerPage(pathname: string): Promise<{ user: AuthenticatedUser; shop: Shop }> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(pathname)}`);

  const context = await getSellerShopContext(user);
  if (!context) redirect('/seller/open');

  return context;
}
