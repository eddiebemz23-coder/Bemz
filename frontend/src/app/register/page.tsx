import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/guards';
import { RegisterForm } from '@/components/auth/register-form';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Register as a buyer in Uganda or Kenya, or open a Bemz shop and start selling.',
  robots: { index: false, follow: false },
};

/**
 * `?role=seller` arrives from the "Sell on Bemz" link in the header, so a trader who clicked it
 * lands on the form with the shop section already open instead of on the buyer variant.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: { role?: string; callbackUrl?: string };
}) {
  const user = await getSessionUser();
  if (user) redirect(safeTarget(searchParams.callbackUrl));

  return (
    <div className="container-page py-8 sm:py-12">
      <RegisterForm
        initialSeller={searchParams.role === 'seller'}
        callbackUrl={safeTarget(searchParams.callbackUrl)}
      />
    </div>
  );
}

function safeTarget(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return candidate;
}
