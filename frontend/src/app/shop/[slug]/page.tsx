import type { Metadata } from 'next';
import Link from 'next/link';
import { BadgeCheck, MapPin, Store as StoreIcon } from 'lucide-react';
import { getShopBySlug } from '@/lib/services/shops';
import { listPublicProducts } from '@/lib/services/products';
import { pageData } from '@/lib/page-data';
import { facetHref, parseSearchQuery, searchHref, toProductQuery } from '@/lib/search-url';
import { displayPhone, etaLabel, formatDate } from '@/lib/client/format';
import { ProductCard } from '@/components/product-card';
import { ResultsBar } from '@/components/catalog/results-bar';
import { RatingBars } from '@/components/review/rating-bars';
import { ListingImage } from '@/components/ui/listing-image';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkButton } from '@/components/ui/link-button';
import { Stars } from '@/components/ui/stars';

/**
 * `GET /shop/[slug]`
 *
 * A stall page in the market's own terms: where it is, how long it takes them to deliver, what
 * they have in stock now — and the reviews that say whether the parcel actually arrives.
 */
export const dynamic = 'force-dynamic';

interface Props {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getShopBySlug(params.slug).catch(() => null);
  if (!page) return { title: 'Shop not found' };

  return {
    title: `${page.shop.name} — Bemz shop`,
    description:
      page.shop.tagline ??
      `${page.shop.productCount} listings from ${page.shop.name} on Bemz Africa.`,
  };
}

export default async function ShopPage({ params, searchParams }: Props) {
  const pathname = `/shop/${params.slug}`;
  const query = parseSearchQuery(searchParams);

  const [page, products] = await Promise.all([
    pageData(getShopBySlug(params.slug)),
    listPublicProducts(toProductQuery({ ...query, shopSlug: params.slug })),
  ]);

  const shop = page.shop;
  const currency = products.items[0]?.currency ?? shop.country.currency;
  const phone = shop.phone ? displayPhone(shop.phone, shop.country.code === 'KE' ? '254' : '256') : null;

  return (
    <div className="container-page py-6">
      <header className="card overflow-hidden">
        <div
          className="h-28 bg-ink-100 bg-cover bg-center sm:h-40"
          style={shop.bannerUrl ? { backgroundImage: `url(${shop.bannerUrl})` } : undefined}
        />
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <ListingImage
            src={shop.logoUrl}
            alt={`${shop.name} logo`}
            className="size-20 shrink-0 rounded-card border-2 border-white"
            sizes="80px"
          />

          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-2 text-xl font-bold text-ink-950 sm:text-2xl">
              <span className="truncate">{shop.name}</span>
              {shop.isVerified && <BadgeCheck className="size-5 shrink-0 text-bemz-600" aria-label="Verified shop" />}
              {shop.isOfficialStore && (
                <span className="shrink-0 rounded bg-bemz-50 px-1.5 py-0.5 text-[11px] font-semibold text-bemz-800">
                  Official store
                </span>
              )}
            </h1>
            {shop.tagline && <p className="mt-1 text-sm text-ink-600">{shop.tagline}</p>}

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
              <span className="inline-flex items-center gap-1">
                <Stars value={shop.ratingAvg} />
                {shop.ratingCount > 0 && <>({shop.ratingCount})</>}
              </span>
              <span>{shop.totalSalesCount.toLocaleString()} orders delivered</span>
              {shop.basedIn && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {shop.basedIn.name}, {shop.country.name}
                </span>
              )}
              <span>On Bemz since {formatDate(shop.since)}</span>
            </div>
          </div>

          <div className="sm:text-right">
            {shop.vacationMode ? (
              <p className="rounded-card bg-clay-50 px-3 py-2 text-xs font-medium text-clay-800">
                On holiday — listings are paused, orders reopen when they return.
              </p>
            ) : (
              <LinkButton href={`/search?shopSlug=${encodeURIComponent(shop.slug)}&sort=popular`} variant="outline" size="sm">
                <StoreIcon className="size-4" />
                Browse their stock
              </LinkButton>
            )}
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap gap-2">
            {page.categories.map((category) => (
              <Link
                key={category.id}
                href={`${pathname}?categorySlug=${encodeURIComponent(category.slug)}`}
                className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:border-bemz-400 hover:text-bemz-700"
              >
                {category.name} <span className="text-ink-400">({category.productCount})</span>
              </Link>
            ))}
          </div>

          <ResultsBar pathname={pathname} query={query} total={products.total} lockShop />

          {products.items.length === 0 ? (
            <EmptyState
              title="Nothing on display right now"
              description={`${shop.name} has no listings matching these filters. Their other stock may still be open for orders.`}
              action={
                <Link
                  href={facetHref(pathname, query, {
                    q: undefined,
                    categorySlug: undefined,
                    brand: undefined,
                    attributes: undefined,
                    minPrice: undefined,
                    maxPrice: undefined,
                    minRating: undefined,
                  })}
                  className="text-sm font-medium text-bemz-700 hover:underline"
                >
                  Clear the filters
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {products.items.map((product, index) => (
                <ProductCard key={product.id} product={product} priority={query.page === 1 && index < 4} />
              ))}
            </div>
          )}

          <Pagination
            page={products.page}
            perPage={products.perPage}
            total={products.total}
            hrefFor={(next) => searchHref(pathname, query, { page: next })}
          />
        </div>

        <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold text-ink-900">About this shop</h2>
            {shop.description ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink-600">{shop.description}</p>
            ) : (
              <p className="text-sm text-ink-500">{shop.name} has not written a shop description yet.</p>
            )}

            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Dispatch time</dt>
                <dd className="font-medium text-ink-900">Within {shop.dispatchSlaHours}h</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Fulfilment</dt>
                <dd className="font-medium text-ink-900">
                  {shop.defaultFulfilment === 'BUYER_PICKUP' ? 'Buyer collects' : 'Seller delivers'}
                </dd>
              </div>
              {shop.basedIn?.estimatedDaysMin != null && shop.basedIn.estimatedDaysMax != null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-500">From their zone</dt>
                  <dd className="font-medium text-ink-900">
                    {etaLabel(shop.basedIn.estimatedDaysMin, shop.basedIn.estimatedDaysMax)}
                  </dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Market</dt>
                <dd className="font-medium text-ink-900">
                  {shop.country.name} · {shop.country.code}
                </dd>
              </div>
            </dl>

            {phone && (
              <p className="text-xs text-ink-500">
                Shop line: <span className="font-medium text-ink-700">{phone}</span> — sellers only share it once an
                order is placed.
              </p>
            )}
          </section>

          <section className="card space-y-3 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="font-semibold text-ink-900">Ratings</h2>
              <Link href={`/shop/${shop.slug}/reviews`} className="text-xs font-medium text-bemz-700 hover:underline">
                Read reviews
              </Link>
            </div>
            <RatingBars breakdown={page.ratingBreakdown} />
          </section>
        </aside>
      </div>
    </div>
  );
}
