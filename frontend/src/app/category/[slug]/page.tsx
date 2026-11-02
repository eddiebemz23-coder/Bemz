import type { Metadata } from 'next';
import Link from 'next/link';
import { categoryLanding } from '@/lib/services/categories';
import { listPublicProducts } from '@/lib/services/products';
import { parseSearchQuery, searchHref, toProductQuery } from '@/lib/search-url';
import { pageData } from '@/lib/page-data';
import { ProductCard } from '@/components/product-card';
import { ResultsBar } from '@/components/catalog/results-bar';
import { SearchFilters } from '@/components/catalog/search-filters';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';
import { ListingImage } from '@/components/ui/listing-image';

/**
 * `GET /category/[slug]`
 *
 * The department page and the filter grid share one URL space with `/search`: the category is set
 * by the path, everything else is a query parameter, so `/category/phones?minPrice=100000` is
 * linkable and survives being forwarded in WhatsApp.
 */
export const dynamic = 'force-dynamic';

interface Props {
  params: { slug: string };
  searchParams: Record<string, string | string[] | undefined>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const landing = await categoryLanding(params.slug).catch(() => null);
  if (!landing) return { title: 'Category not found' };

  const description =
    landing.category.description ??
    `${landing.facets.totalProducts} listings in ${landing.category.name}, delivered across Uganda and Kenya.`;

  return {
    title: `${landing.category.name} — buy from verified sellers`,
    description,
  };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const query = parseSearchQuery(searchParams);
  const pathname = `/category/${params.slug}`;

  const [landing, results] = await Promise.all([
    pageData(categoryLanding(params.slug)),
    listPublicProducts(toProductQuery({ ...query, categorySlug: params.slug })),
  ]);

  const currency = results.items[0]?.currency ?? 'UGX';

  return (
    <div className="container-page py-6">
      <nav aria-label="Breadcrumb" className="text-sm text-ink-500">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-bemz-700">
              Home
            </Link>
          </li>
          {landing.breadcrumb.map((crumb, index) => (
            <li key={crumb.slug} className="flex items-center gap-1.5">
              <span aria-hidden>/</span>
              {index === landing.breadcrumb.length - 1 ? (
                <span aria-current="page" className="font-medium text-ink-900">
                  {crumb.name}
                </span>
              ) : (
                <Link href={`/category/${crumb.slug}`} className="hover:text-bemz-700">
                  {crumb.name}
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <header className="mt-3 flex items-start gap-4">
        <ListingImage
          src={landing.category.imageUrl}
          alt=""
          className="size-16 shrink-0 rounded-card"
          sizes="64px"
        />
        <div>
          <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">{landing.category.name}</h1>
          {landing.category.description && (
            <p className="mt-1 max-w-2xl text-sm text-ink-600">{landing.category.description}</p>
          )}
        </div>
      </header>

      {landing.children.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {landing.children.map((child) => (
            <Link
              key={child.id}
              href={`/category/${child.slug}`}
              className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:border-bemz-400 hover:text-bemz-700"
            >
              {child.name}
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <SearchFilters pathname={pathname} query={query} currency={currency} facets={landing.facets} />
        </aside>

        <div className="min-w-0 space-y-5">
          <ResultsBar pathname={pathname} query={query} total={results.total} lockCategory />

          {results.items.length === 0 ? (
            <EmptyState
              title={`No ${landing.category.name.toLowerCase()} listings match those filters`}
              description="The department may be new, or the filters are too tight. Widen the price range or clear the filters."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {results.items.map((product, index) => (
                <ProductCard key={product.id} product={product} priority={query.page === 1 && index < 4} />
              ))}
            </div>
          )}

          <Pagination
            page={results.page}
            perPage={results.perPage}
            total={results.total}
            hrefFor={(page) => searchHref(pathname, query, { page })}
          />
        </div>
      </div>

      {landing.topShops.length > 0 && (
        <section className="mt-10 space-y-3">
          <h2 className="text-lg font-bold text-ink-900">Top sellers in {landing.category.name}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {landing.topShops.map((shop) => (
              <Link key={shop.id} href={`/shop/${shop.slug}`} className="card flex items-center gap-3 p-3 hover:shadow-raised">
                <ListingImage src={shop.logoUrl} alt="" className="size-12 shrink-0 rounded-lg" sizes="48px" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-900">{shop.name}</p>
                  <p className="text-xs text-ink-500">
                    {shop.productCount} listings
                    {shop.ratingAvg !== null && ` · ${shop.ratingAvg.toFixed(1)}★`}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
