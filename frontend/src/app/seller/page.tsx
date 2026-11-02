import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, MessageSquare, Star, Store, Tags } from 'lucide-react';
import { sellerPage } from '@/lib/seller-page';
import { sellerShopOverview, effectiveCommissionBps } from '@/lib/services/shops';
import { listOrders, sellerOrderStats } from '@/lib/services/orders';
import { payoutSummary } from '@/lib/services/payouts';
import { shopQuestions, shopReviewsToAnswer } from '@/lib/services/reviews';
import { fromBps, formatRelative, money } from '@/lib/client/format';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/link-button';
import { ListingImage } from '@/components/ui/listing-image';
import { Stars } from '@/components/ui/stars';

/**
 * `GET /seller`
 *
 * A dashboard answers two questions and nothing else: what is waiting on me right now, and where is
 * my money. Every tile is a link to the screen that acts on it, so the page itself needs no
 * client JavaScript and loads on the same path as the rest of the site.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Seller dashboard', robots: { index: false } };

const KYC_LABEL: Record<string, { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; text: string }> = {
  NOT_SUBMITTED: { tone: 'warning', text: 'ID not uploaded' },
  SUBMITTED: { tone: 'info', text: 'ID submitted' },
  UNDER_REVIEW: { tone: 'info', text: 'ID under review' },
  APPROVED: { tone: 'success', text: 'ID approved' },
  REJECTED: { tone: 'danger', text: 'ID rejected' },
};

export default async function SellerOverviewPage() {
  const { user, shop } = await sellerPage('/seller');

  const [overview, stats, balance, recent, questions, reviews] = await Promise.all([
    sellerShopOverview(shop.id),
    sellerOrderStats(shop.id),
    payoutSummary(shop),
    listOrders(user, { shopId: shop.id, page: 1, perPage: 5 }),
    shopQuestions(shop.id, { unansweredOnly: true, perPage: 3 }),
    shopReviewsToAnswer(shop.id, 3),
  ]);
  const commissionBps = await effectiveCommissionBps(shop);

  const { counts } = overview;
  const listings = counts.productsByStatus;
  const kyc = KYC_LABEL[shop.kycStatus] ?? { tone: 'neutral' as const, text: shop.kycStatus };

  const queue = [
    { label: 'Waiting for the buyer to confirm', status: 'AWAITING_CONFIRMATION', count: stats.statuses.AWAITING_CONFIRMATION?.count ?? 0 },
    { label: 'Confirmed — pack these', status: 'CONFIRMED', count: stats.statuses.CONFIRMED?.count ?? 0 },
    { label: 'Packed — hand to a rider', status: 'PACKED', count: stats.statuses.PACKED?.count ?? 0 },
    { label: 'With a rider now', status: 'OUT_FOR_DELIVERY', count: stats.statuses.OUT_FOR_DELIVERY?.count ?? 0 },
  ];

  return (
    <div className="space-y-5">
      <section className="card overflow-hidden">
        <div className="relative h-24 bg-ink-100">
          {overview.shop.bannerUrl ? (
            <ListingImage
              src={overview.shop.bannerUrl}
              alt={`${overview.shop.name} banner`}
              className="h-24"
              sizes="100vw"
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-start gap-4 p-5">
          <ListingImage
            src={overview.shop.logoUrl}
            alt={`${overview.shop.name} logo`}
            className="size-16 shrink-0 rounded-card ring-1 ring-inset ring-ink-200"
            sizes="64px"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-ink-950">{overview.shop.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-600">
              <Link href={`/shop/${overview.shop.slug}`} className="inline-flex items-center gap-1 font-medium text-bemz-700 hover:underline">
                /shop/{overview.shop.slug}
                <ArrowUpRight className="size-3.5" />
              </Link>
              <Stars value={overview.shop.ratingAvg} />
              <span className="text-ink-500">
                {overview.shop.ratingCount.toLocaleString()} {overview.shop.ratingCount === 1 ? 'rating' : 'ratings'}
              </span>
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={overview.shop.status === 'ACTIVE' ? 'success' : overview.shop.status === 'SUSPENDED' || overview.shop.status === 'CLOSED' ? 'danger' : 'warning'}>
                {overview.shop.status === 'ACTIVE' ? 'Live' : overview.shop.status.toLowerCase()}
              </Badge>
              <Badge tone={kyc.tone}>{kyc.text}</Badge>
              {overview.shop.isVerified && <Badge tone="brand">Verified</Badge>}
              {overview.shop.vacationMode && <Badge tone="warning">On holiday</Badge>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <LinkButton href="/seller/products/new" size="sm">
              <Tags className="size-4" />
              Add a listing
            </LinkButton>
            <p className="text-xs text-ink-500">
              Commission {fromBps(commissionBps)} · {overview.shop.dispatchSlaHours}h dispatch promise
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 divide-x divide-ink-100 border-t border-ink-100 text-center sm:grid-cols-4">
          {[
            { term: 'Items sold', value: overview.shop.totalSalesCount.toLocaleString() },
            { term: 'Followers', value: overview.shop.followers.toLocaleString() },
            { term: 'Lifetime sales', value: money(overview.shop.totalSalesMinor, overview.shop.currency, true) },
            { term: 'Based in', value: overview.shop.basedIn?.name ?? 'Not set' },
          ].map((cell) => (
            <div key={cell.term} className="px-2 py-3">
              <dt className="text-xs text-ink-500">{cell.term}</dt>
              <dd className="tabular mt-0.5 truncate text-sm font-semibold text-ink-900">{cell.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Waiting on you</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {queue.map((entry) => (
            <Link
              key={entry.status}
              href={`/seller/orders?status=${entry.status}`}
              className="card flex items-start justify-between gap-3 p-4 transition-shadow hover:shadow-raised"
            >
              <span className="min-w-0">
                <span className="tabular block text-2xl font-bold text-ink-950">{entry.count}</span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-600">{entry.label}</span>
              </span>
              {entry.count > 0 && <ArrowUpRight className="size-4 shrink-0 text-bemz-700" />}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="space-y-5">
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Latest parcels</h2>
              <Link href="/seller/orders" className="text-sm font-medium text-bemz-700 hover:underline">
                Order queue
              </Link>
            </div>
            {recent.orders.length === 0 ? (
              <p className="mt-3 text-sm text-ink-600">
                No orders yet. Listings with a photo, a real price and stock in the options are what
                buyers order from — start there.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-ink-100">
                {recent.orders.map((order) => (
                  <li key={order.id}>
                    <Link href={`/orders/${order.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-ink-50">
                      <span className="min-w-0">
                        <span className="tabular block text-sm font-semibold text-ink-900">{order.orderNumber}</span>
                        <span className="block text-xs text-ink-600">
                          {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'} ·{' '}
                          {order.districtName ?? 'district not recorded'} · {formatRelative(order.placedAt)}
                        </span>
                      </span>
                      <span className="tabular text-sm font-semibold text-ink-900">
                        {money(order.totalMinor, order.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Your listings</h2>
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Live', status: 'ACTIVE', count: listings.ACTIVE ?? 0 },
                { label: 'Drafts', status: 'DRAFT', count: listings.DRAFT ?? 0 },
                { label: 'Awaiting review', status: 'PENDING_REVIEW', count: listings.PENDING_REVIEW ?? 0 },
                { label: 'Rejected', status: 'REJECTED', count: listings.REJECTED ?? 0 },
                { label: 'Taken down', status: 'ARCHIVED', count: listings.ARCHIVED ?? 0 },
              ].map((tile) => (
                <li key={tile.status}>
                  <Link href={`/seller/products?status=${tile.status}`} className="block rounded-card bg-ink-50 px-3 py-2.5 hover:bg-ink-100">
                    <span className="tabular block text-lg font-bold text-ink-950">{tile.count}</span>
                    <span className="block text-xs text-ink-600">{tile.label}</span>
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href="/seller/products?status=ACTIVE"
                  className={`block rounded-card px-3 py-2.5 ${counts.outOfStockVariants > 0 ? 'bg-clay-50 ring-1 ring-inset ring-clay-200' : 'bg-ink-50 hover:bg-ink-100'}`}
                >
                  <span className={`tabular block text-lg font-bold ${counts.outOfStockVariants > 0 ? 'text-clay-700' : 'text-ink-950'}`}>
                    {counts.outOfStockVariants}
                  </span>
                  <span className="block text-xs text-ink-600">Options with no stock</span>
                </Link>
              </li>
            </ul>
          </section>
        </div>

        <div className="space-y-5">
          <section className="card space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Money</h2>
              <Link href="/seller/payouts" className="text-sm font-medium text-bemz-700 hover:underline">
                Payouts
              </Link>
            </div>
            <p className="text-3xl font-bold tabular text-ink-950">{balance.availableLabel}</p>
            <p className="text-xs text-ink-500">
              Withdrawable now · from {balance.clearedOrderCount}{' '}
              {balance.clearedOrderCount === 1 ? 'delivered order' : 'delivered orders'} past the{' '}
              {balance.settlementDelayDays}-day dispute window
            </p>
            <dl className="space-y-1.5 border-t border-ink-100 pt-3 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-600">Still clearing</dt>
                <dd className="tabular font-medium text-ink-900">{money(balance.clearingMinor, balance.currency)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-600">Cash a rider is holding</dt>
                <dd className="tabular font-medium text-ink-900">{money(balance.cashWithRidersMinor, balance.currency)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-600">Requested, not sent yet</dt>
                <dd className="tabular font-medium text-ink-900">{money(balance.requestedMinor, balance.currency)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-600">Withdrawn all-time</dt>
                <dd className="tabular font-medium text-ink-900">{money(balance.lifetimeWithdrawnMinor, balance.currency)}</dd>
              </div>
            </dl>
            {balance.blockers.length > 0 ? (
              <ul className="space-y-1 rounded-card bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {balance.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            ) : (
              <LinkButton href="/seller/payouts" size="sm" block>
                Request a payout
              </LinkButton>
            )}
            <p className="text-xs text-ink-500">
              Paid out to{' '}
              {balance.account
                ? `${balance.account.provider.replace(/_/g, ' ').toLowerCase()} ${balance.account.accountNumber}`
                : 'no account yet — add one on the Shop page'}
              .
            </p>
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Inbox</h2>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-ink-700">
                <MessageSquare className="size-4 text-ink-400" />
                Questions waiting
              </span>
              <span className="tabular font-semibold text-ink-900">{questions.length}</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-1.5 text-ink-700">
                <Star className="size-4 text-ink-400" />
                Reviews with no reply
              </span>
              <span className="tabular font-semibold text-ink-900">{reviews.length}</span>
            </div>
            {questions[0] && (
              <p className="rounded-card bg-ink-50 px-3 py-2 text-xs text-ink-700">
                <span className="font-medium">{questions[0].product.title}:</span> {questions[0].body}
              </p>
            )}
            <LinkButton href="/seller/inbox" variant="outline" size="sm" block>
              <Store className="size-4" />
              Answer buyers
            </LinkButton>
          </section>
        </div>
      </div>
    </div>
  );
}
