import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/guards';
import { LoginForm } from '@/components/auth/login-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to Bemz with a code sent to your phone, or with a password.',
  robots: { index: false, follow: false },
};

/**
 * `callbackUrl` is the page the buyer was on when the site asked them to sign in — checkout, a
 * seller dashboard, an order. It is echoed back only after the session exists.
 */
export default async function LoginPage({ searchParams }: { searchParams: { callbackUrl?: string } }) {
  const user = await getSessionUser();
  if (user) redirect(safeTarget(searchParams.callbackUrl));

  return (
    <div className="container-page py-8 sm:py-12">
      <LoginForm callbackUrl={safeTarget(searchParams.callbackUrl)} />
    </div>
  );
}

/** Only ever a same-origin relative path — a signed-in visitor must not be bounced off-site. */
function safeTarget(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return candidate;
}
