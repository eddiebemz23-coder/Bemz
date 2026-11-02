import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, Tags } from 'lucide-react';
import { sellerPage } from '@/lib/seller-page';
import { listSellerProducts } from '@/lib/services/products';
import { sellerProductQuerySchema } from '@/lib/validation/catalog';
import { hrefWith, parseParams } from '@/lib/catalog-params';
import { formatDate, humanise, money } from '@/lib/client/format';
import type { SellerProductRow } from '@/lib/client/types';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/link-button';
import { EmptyState } from '@/components/ui/empty-state';
import { ListingImage } from '@/components/ui/listing-image';
import { Pagination } from '@/components/ui/pagination';
import { StatusPill } from '@/components/ui/status-pill';
import { ListingActions } from '@/components/seller/listing-actions';

/**
 * `GET /seller/products`
 *
 * The workshop, not the shop window: drafts, listings still with the review team and listings that
 * were rejected all appear here, because a trader who cannot see what they abandoned cannot finish
 * it. A rejected row carries the moderator's reason — "we said no" without one is how sellers give
 * up on a marketplace.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'My listings', robots: { index: false } };

const TABS: { label: string; status?: string }[] = [
  { label: 'Everything' },
  { label: 'Live', status: 'ACTIVE' },
  { label: 'Drafts', status: 'DRAFT' },
  { label: 'Awaiting review', status: 'PENDING_REVIEW' },
  { label: 'Rejected', status: 'REJECTED' },
  { label: 'Taken down', status: 'ARCHIVED' },
];

interface Props {
  searchParams: Record<string, string | string[] | undefined>;
}

/** The stock a buyer can actually order: what is on the shelf minus what sits in someone's basket. */
function stockSummary(listing: SellerProductRow) {
  const live = listing.variants.filter((variant) => !variant.isDisabled);
  const available = live.reduce((sum, variant) => sum + variant.available, 0);
  const reserved = listing.variants.reduce((sum, variant) => sum + variant.reservedQuantity, 0);
  const options = listing.variants.length;
  return { available, reserved, options, soldOut: available === 0 };
}

export default async function SellerProductsPage({ searchParams }: Props) {
  const { shop } = await sellerPage('/seller/products');
  const query = parseParams(sellerProductQuerySchema, searchParams);
  const { items, total, page, perPage } = await listSellerProducts(shop.id, query);

  const hrefFor = (overrides: Record<string, string | number | undefined>) =>
    hrefWith('/seller/products', { status: query.status, q: query.q }, overrides);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-950">My listings</h1>
          <p className="mt-1 text-sm text-ink-600">
            {total.toLocaleString()} {total === 1 ? 'listing' : 'listings'} in{' '}
            <Link href={`/shop/${shop.slug}`} className="font-medium text-bemz-700 hover:underline">
              {shop.name}
            </Link>
          </p>
        </div>
        <form method="get" action="/seller/products" className="flex items-end gap-2">
          {query.status && <input type="hidden" name="status" value={query.status} />}
          <div>
            <label className="field-label" htmlFor="listings-q">
              Search your listings
            </label>
            <div className="flex gap-2">
              <input
                id="listings-q"
                name="q"
                type="search"
                defaultValue={query.q ?? ''}
                placeholder="Telefon"
                className="field-input"
              />
              <button type="submit" className="rounded-lg bg-bemz-600 px-3 text-sm font-semibold text-white hover:bg-bemz-700">
                Find
              </button>
            </div>
          </div>
        </form>
      </header>

      <nav className="flex flex-wrap gap-1.5" aria-label="Listing status">
        {TABS.map((tab) => (
          <Link
            key={tab.label}
            href={hrefFor({ status: tab.status, page: undefined, q: query.q })}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              (tab.status ?? undefined) === (query.status ?? undefined)
                ? 'bg-bemz-600 font-semibold text-white'
                : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2 rounded-card bg-ink-50 px-4 py-3 text-xs text-ink-600">
        <Tags className="size-4 shrink-0 text-ink-400" />
        <span>
          Stock is only changed through the listing editor, and every unit is recorded with a reason —
          that is what stops a restock typed twice over a bad connection from being counted twice.
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title={query.q ? 'No listing matches that search' : 'No listings here yet'}
          description={
            query.q
              ? 'Search looks at the item title only. Clear the search to see everything.'
              : 'Add your first item: a real photo, the price per option and the stock you have on the shelf.'
          }
          icon={<Tags className="size-7" />}
          action={<LinkButton href="/seller/products/new">Add a listing</LinkButton>}
        />
      ) : (
        <ul className="space-y-3">
          {items.map((listing) => {
            const stock = stockSummary(listing);
            return (
              <li key={listing.id}>
                <article className="card p-4">
                  <div className="flex flex-wrap gap-4">
                    <Link href={`/seller/products/${listing.id}`} className="shrink-0">
                      <ListingImage
                        src={listing.imageUrl}
                        alt={listing.title}
                        className="size-20 rounded-card"
                        sizes="80px"
                      />
                    </Link>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/seller/products/${listing.id}`}
                          className="text-sm font-semibold text-ink-900 hover:text-bemz-700"
                        >
                          {listing.title}
                        </Link>
                        <StatusPill status={listing.status} />
                        {listing.fulfilmentType === 'DIGITAL' && <Badge tone="info">Digital</Badge>}
                        {listing.categories.some((category) => category.requiresKyc) && (
                          <Badge tone="warning">ID needed</Badge>
                        )}
                      </div>

                      <p className="text-xs text-ink-500">
                        {listing.slug} · {stock.options} {stock.options === 1 ? 'option' : 'options'} ·
                        updated {formatDate(listing.updatedAt)}
                        {listing.soldCount > 0 ? ` · ${listing.soldCount} sold` : ''}
                        {listing.viewsCount > 0 ? ` · ${listing.viewsCount.toLocaleString()} views` : ''}
                        {listing.ratingCount > 0 ? ` · ${listing.ratingCount} ratings` : ''}
                      </p>

                      {listing.rejectionReason && (
                        <p className="rounded-card border border-clay-200 bg-clay-50 px-3 py-2 text-xs text-clay-800">
                          <span className="font-semibold">Reviewer said no:</span> {listing.rejectionReason}
                          {' — fix it and press publish to send it back.'}
                        </p>
                      )}
                    </div>

                    <div className="flex min-w-[8rem] flex-col items-end gap-1 text-right">
                      <p className="tabular text-sm font-bold text-ink-900">
                        {listing.startingPriceMinor === null
                          ? 'No price yet'
                          : `${stock.options > 1 ? 'from ' : ''}${money(listing.startingPriceMinor, listing.currency)}`}
                      </p>
                      <p
                        className={`text-xs ${
                          stock.soldOut ? 'font-semibold text-clay-700' : 'text-ink-500'
                        }`}
                      >
                        {stock.soldOut ? 'Nothing to sell' : `${stock.available} in stock`}
                        {stock.reserved > 0 ? ` · ${stock.reserved} held in baskets` : ''}
                      </p>
                      {listing.status === 'ACTIVE' && (
                        <Link
                          href={`/product/${shop.slug}/${listing.slug}`}
                          className="inline-flex items-center gap-0.5 text-xs font-medium text-bemz-700 hover:underline"
                        >
                          See it as a buyer
                          <ArrowUpRight className="size-3" />
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 pt-3">
                    <p className="text-xs text-ink-500">
                      {humanise(listing.condition)}
                      {listing.brand ? ` · ${listing.brand}` : ''} ·{' '}
                      {listing.categories.map((category) => category.name).join(', ') || 'no category'}
                    </p>
                    <div className="flex items-center gap-2">
                      <LinkButton href={`/seller/products/${listing.id}`} variant="outline" size="sm">
                        Edit
                      </LinkButton>
                      <ListingActions listing={listing} />
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination page={page} perPage={perPage} total={total} hrefFor={(next) => hrefFor({ page: next === 1 ? undefined : next })} />

      <div className="flex justify-end">
        <LinkButton href="/seller/products/new">
          <Tags className="size-4" />
          Add a listing
        </LinkButton>
      </div>
    </div>
  );
}
