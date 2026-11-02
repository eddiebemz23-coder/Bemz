import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionUser, getSellerShopContext } from '@/lib/auth/guards';
import { SellerNav } from '@/components/seller/seller-nav';
import { ShopStatusBanner } from '@/components/seller/shop-status-banner';

/**
 * `GET /seller/**`
 *
 * The shell is only drawn once the trader actually has a stall: `/seller/open` renders inside this
 * same layout, and a nav that points at five screens a seller cannot use yet is worse than none.
 *
 * `robots: index: false` — a dashboard is not a page, and an order-number title leaking into a
 * search result is how a stranger finds out who buys from whom.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Seller dashboard', robots: { index: false } };

export default async function SellerLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login?callbackUrl=%2Fseller');

  const context = await getSellerShopContext(user);

  return (
    <>
      {context && <SellerNav storefrontHref={`/shop/${context.shop.slug}`} />}
      <div className="container-page space-y-5 py-6">
        {context && (
          <ShopStatusBanner
            status={context.shop.status}
            kycStatus={context.shop.kycStatus}
            vacationMode={context.shop.vacationMode}
          />
        )}
        {children}
      </div>
    </>
  );
}
