import 'server-only';
import { notFound, redirect } from 'next/navigation';
import { getSessionUser, type AuthenticatedUser } from './auth/guards';

/**
 * The one entry condition every `/admin/**` page shares.
 *
 * A signed-out operator is sent to the phone login with the screen they asked for, so the
 * callback lands them back on the queue they were working. Someone signed in as a buyer or a
 * seller gets a plain 404 rather than a "you are not allowed" page: the tool exists, but telling
 * the wrong person that confirms which URLs to try next.
 */
export async function adminPage(pathname: string): Promise<AuthenticatedUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
  if (user.role !== 'ADMIN') notFound();

  return user;
}
