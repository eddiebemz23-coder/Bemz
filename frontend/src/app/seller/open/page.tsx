import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser, getSellerShopContext } from '@/lib/auth/guards';
import { regionForCurrency } from '@/lib/client/regions';
import { OpenShopForm } from '@/components/seller/open-shop-form';

/**
 * `GET /seller/open`
 *
 * The one seller screen that works without a stall, so it is the page every other `/seller/**`
 * route sends a trader to when they have not opened one. Reaching it while a shop already exists
 * goes back to the dashboard: `POST /api/shops` answers 409 for a second stall, and a form that
 * can only fail is not a page.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Open a shop',
  description:
    'Sell on Bemz Africa in Uganda or Kenya: list items in UGX or KES, get paid to MTN Mobile Money or Airtel Money, and deliver to your district.',
};

export default async function OpenShopPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?callbackUrl=%2Fseller%2Fopen');

  const existingShop = await getSellerShopContext(user);
  if (existingShop) redirect('/seller');

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-bemz-700">Selling on Bemz</p>
        <h1 className="text-2xl font-bold text-ink-950">Open your shop</h1>
        <p className="max-w-2xl text-sm text-ink-600">
          One stall per account, priced in the currency of the market you choose. Opening is free and
          takes about two minutes — you can list items immediately, and orders start once the review
          team approves the shop.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <OpenShopForm defaultCountry={regionForCurrency(user.preferredCurrency)} />

        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="text-sm font-semibold text-ink-900">What happens after you open</h2>
            <ol className="mt-3 space-y-3 text-sm text-ink-700">
              <li>
                <span className="font-medium text-ink-900">1. Add your items.</span> Photos, price per
                option and the stock you actually have on the shelf.
              </li>
              <li>
                <span className="font-medium text-ink-900">2. Upload your national ID.</span> Phones,
                building materials and agro-chemicals need it, and so does your first payout.
              </li>
              <li>
                <span className="font-medium text-ink-900">3. Get reviewed.</span> A person checks the
                shop and the documents. You can keep listing while that is running.
              </li>
              <li>
                <span className="font-medium text-ink-900">4. Pack and dispatch.</span> Each order shows
                in your queue with the district, the phone number and what the buyer paid.
              </li>
            </ol>
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold text-ink-900">What it costs</h2>
            <ul className="mt-3 space-y-2 text-sm text-ink-700">
              <li>No monthly fee and no fee to list an item.</li>
              <li>
                A commission is taken from each delivered order. The rate depends on the category and is
                shown next to every listing you create.
              </li>
              <li>
                Delivery fees collected from buyers pay the rider, not you, unless you deliver the parcel
                yourself.
              </li>
              <li>
                Money from a delivered order becomes withdrawable after the dispute window closes, then
                you request the payout to your mobile money number.
              </li>
            </ul>
            <p className="mt-3 text-xs text-ink-500">
              Cash a rider collects on a delivery-you-sent order is handed to you by that rider, so it is
              not in your Bemz balance.
            </p>
          </section>

          <section className="card space-y-2 p-5">
            <h2 className="text-sm font-semibold text-ink-900">Not ready to sell yet?</h2>
            <p className="text-sm text-ink-600">
              Browse what other traders in your district are listing, and price yours against it.
            </p>
            <Link href="/shops" className="text-sm font-medium text-bemz-700 hover:underline">
              See shops on Bemz
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
