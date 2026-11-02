import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Heart, MapPin, Package, Star, Store, LayoutGrid } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/guards';
import { loadMe, listAddresses } from '@/lib/services/accounts';
import { listOrders } from '@/lib/services/orders';
import { pageData } from '@/lib/page-data';
import { displayPhone, formatDate, money } from '@/lib/client/format';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/link-button';
import { ProfileForm } from '@/components/account/profile-form';
import { PasswordForm } from '@/components/account/password-form';

/**
 * `GET /account`
 *
 * The buyer's own record: who we know them as, how they sign in, where parcels go and what they
 * have spent. Everything here is either read from the database or patched through `/api/me`, so a
 * phone number that has been verified by an SMS code is never changed by a form on this page —
 * changing the number means signing in with a code to the new one.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Account settings', description: 'Your profile, sign-in and delivery details.', robots: { index: false } };

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?callbackUrl=%2Faccount');

  const me = await pageData(loadMe(user.id));
  const [addresses, recent] = await Promise.all([
    listAddresses(user.id),
    listOrders(user, { page: 1, perPage: 3 }),
  ]);

  const shops = me.shopsOwned;

  return (
    <div className="container-page space-y-5 py-6">
      <header className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-ink-950">{me.name ?? displayPhone(me.phone)}</h1>
            <p className="mt-1 text-sm text-ink-600">
              {displayPhone(me.phone, me.country?.phonePrefix)}
              {me.email ? ` · ${me.email}` : ''}
            </p>
            <p className="mt-0.5 text-xs text-ink-500">
              {me.country ? `${me.country.name} · prices shown in ${me.preferredCurrency}` : `Prices shown in ${me.preferredCurrency}`} ·
              member since {formatDate(me.createdAt, 'long')}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={me.phoneVerified ? 'success' : 'warning'}>
              {me.phoneVerified ? `Phone verified ${formatDate(me.phoneVerified)}` : 'Phone not verified yet'}
            </Badge>
            <div className="flex gap-2">
              <LinkButton href="/orders" variant="outline" size="sm">
                <Package className="size-4" />
                My orders
              </LinkButton>
              <LinkButton href="/account/addresses" variant="outline" size="sm">
                <MapPin className="size-4" />
                Addresses
              </LinkButton>
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 border-t border-ink-200 pt-3 sm:grid-cols-4">
          <Stat icon={<Package className="size-4" />} label="Orders placed" value={me.stats.orders.toLocaleString()} href="/orders" />
          <Stat icon={<Star className="size-4" />} label="Reviews written" value={me.stats.reviews.toLocaleString()} />
          <Stat icon={<Heart className="size-4" />} label="Saved items" value={me.stats.wishlistEntries.toLocaleString()} />
          <Stat
            icon={<MapPin className="size-4" />}
            label="Delivery stops"
            value={addresses.length.toLocaleString()}
            href="/account/addresses"
          />
        </dl>
      </header>

      {recent.orders.length > 0 && (
        <section className="card space-y-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-900">Latest parcels</h2>
            <Link href="/orders" className="text-xs font-medium text-bemz-700 hover:underline">
              All orders
            </Link>
          </div>
          <ul className="divide-y divide-ink-100">
            {recent.orders.map((order) => (
              <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/orders/${order.id}`} className="min-w-0 flex-1 truncate hover:text-bemz-700">
                  <span className="tabular font-medium text-ink-900">{order.orderNumber}</span>
                  <span className="text-ink-500"> · {order.shopName} · {order.itemCount} items · {formatDate(order.placedAt)}</span>
                </Link>
                <span className="tabular font-semibold text-ink-900">{money(order.totalMinor, order.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(shops.length > 0 || user.role === 'SELLER' || user.role === 'ADMIN') && (
        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold text-ink-900">Selling</h2>
          {shops.length === 0 ? (
            <p className="text-sm text-ink-600">
              Your account is set up to sell, but no shop is open yet. Everything starts from the seller dashboard.
            </p>
          ) : (
            <ul className="space-y-2">
              {shops.map((shop) => (
                <li key={shop.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-ink-200 px-3 py-2">
                  <p className="flex items-center gap-2 text-sm">
                    <Store className="size-4 text-ink-400" aria-hidden />
                    <Link href={`/shop/${shop.slug}`} className="font-medium text-ink-900 hover:text-bemz-700">
                      {shop.name}
                    </Link>
                    <span className="text-xs text-ink-500">
                      {shop.ratingCount > 0
                        ? `${shop.ratingAvg === null ? '—' : Number(shop.ratingAvg).toFixed(1)} from ${shop.ratingCount} ratings`
                        : 'not rated yet'}
                    </span>
                  </p>
                  <p className="flex items-center gap-2 text-xs">
                    <Badge tone={shop.status === 'ACTIVE' ? 'success' : shop.status === 'SUSPENDED' ? 'danger' : 'neutral'}>{shop.status.toLowerCase()}</Badge>
                    {shop.kycStatus !== 'APPROVED' && <Badge tone="warning">KYC {shop.kycStatus.toLowerCase().replace(/_/g, ' ')}</Badge>}
                    {shop.vacationMode && <Badge tone="warning">on holiday</Badge>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <LinkButton href="/seller" size="sm">
              <LayoutGrid className="size-4" />
              Seller dashboard
            </LinkButton>
            {user.role === 'ADMIN' && (
              <LinkButton href="/admin" variant="outline" size="sm">
                Admin dashboard
              </LinkButton>
            )}
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold text-ink-900">Your details</h2>
          <ProfileForm
            profile={{
              name: me.name,
              email: me.email,
              gender: me.gender,
              preferredCurrency: me.preferredCurrency,
              languageCode: me.languageCode,
              marketingOptIn: me.marketingOptIn,
              whatsappOptIn: me.whatsappOptIn,
            }}
          />
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="text-sm font-semibold text-ink-900">Signing in</h2>
          <p className="text-sm text-ink-600">
            Number on file: <span className="tabular font-medium text-ink-900">{displayPhone(me.phone, me.country?.phonePrefix)}</span>
            {me.phoneVerified ? (
              <span className="block text-xs text-bemz-700">
                Verified {formatDate(me.phoneVerified)} — an SMS code to this number is enough to sign in.
              </span>
            ) : (
              <span className="block text-xs text-amber-800">
                Not verified yet. Sign in once with the code sent to this number and it is proved for good.
              </span>
            )}
          </p>
          <div className="border-t border-ink-200 pt-4">
            <PasswordForm hasPassword={me.hasPassword} />
          </div>
        </section>
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-ink-900">Default delivery stop</h2>
        {me.primaryAddress ? (
          <p className="text-sm text-ink-700">
            <span className="font-medium text-ink-900">{me.primaryAddress.label ?? 'Home'}</span> ·{' '}
            {me.primaryAddress.district?.name ?? 'district no longer available'}
            {me.primaryAddress.nearestLandmark ? ` · near ${me.primaryAddress.nearestLandmark}` : ''}
          </p>
        ) : (
          <p className="text-sm text-ink-600">
            No address saved yet — the first one you add becomes the default, and checkout starts there.
          </p>
        )}
        <LinkButton href="/account/addresses" variant={me.primaryAddress ? 'ghost' : 'primary'} size="sm">
          <MapPin className="size-4" />
          {me.primaryAddress ? 'Manage delivery addresses' : 'Add a delivery address'}
        </LinkButton>
      </section>

      <p className="px-1 text-xs leading-relaxed text-ink-500">
        Your phone number is the account in both markets — email stays optional. If you lose the SIM, contact support
        with the number and the order numbers you can still see here; the payment trail on each order is what proves the
        parcels were yours.
      </p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="text-ink-400">{icon}</span>
      <span className="block text-lg font-bold tabular text-ink-900">{value}</span>
      <span className="block text-xs text-ink-500">{label}</span>
    </>
  );

  return href ? (
    <Link href={href} className="rounded-card bg-ink-50 px-3 py-2 transition-colors hover:bg-ink-100">
      {body}
    </Link>
  ) : (
    <div className="rounded-card bg-ink-50 px-3 py-2">{body}</div>
  );
}
