import type { Metadata } from 'next';
import Link from 'next/link';
import { listPublicProducts } from '@/lib/services/products';
import { DEFAULT_SEARCH_QUERY, parseSearchQuery, searchHref, toProductQuery } from '@/lib/search-url';
import { ProductCard } from '@/components/product-card';
import { ResultsBar } from '@/components/catalog/results-bar';
import { SearchFilters } from '@/components/catalog/search-filters';
import { Pagination } from '@/components/ui/pagination';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * `GET /search`
 *
 * Every filter is a query-string parameter and every parameter is in the URL, so a buyer can
 * paste "cheap phones in stock" into a WhatsApp group and land on the same grid. The sidebar is a
 * real GET form: no JavaScript is required to use any of it.
 *
 * Dynamic rather than revalidated because it reads the query string.
 */
export const dynamic = 'force-dynamic';

const PATHNAME = '/search';

export const metadata: Metadata = {
  title: 'Search Bemz',
  description: 'Search Ugandan and Kenyan listings by keyword, price, brand, rating and availability.',
};

export default async function SearchPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const query = parseSearchQuery(searchParams);
  const results = await listPublicProducts(toProductQuery(query));
  const currency = results.items[0]?.currency ?? 'UGX';
  const heading = query.q ? `Results for “${query.q}”` : 'All listings';

  return (
    <div className="container-page py-6">
      <h1 className="text-xl font-bold text-ink-900 sm:text-2xl">{heading}</h1>
      <p className="mt-1 text-sm text-ink-500">
        {results.total.toLocaleString()} listings across Uganda and Kenya. Prices include VAT where it applies.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <SearchFilters pathname={PATHNAME} query={query} currency={currency} />
        </aside>

        <div className="min-w-0 space-y-5">
          <ResultsBar pathname={PATHNAME} query={query} total={results.total} />

          {results.items.length === 0 ? (
            <EmptyState
              title="Nothing matched those filters"
              description="Try a shorter keyword, widen the price range, or clear the filters and browse by department."
              action={
                <Link href={searchHref(PATHNAME, DEFAULT_SEARCH_QUERY)} className="text-sm font-medium text-bemz-700 hover:underline">
                  Clear all filters
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {results.items.map((product, index) => (
                <ProductCard key={product.id} product={product} priority={results.page === 1 && index < 4} />
              ))}
            </div>
          )}

          <Pagination
            page={results.page}
            perPage={results.perPage}
            total={results.total}
            hrefFor={(page) => searchHref(PATHNAME, query, { page })}
          />
        </div>
      </div>
    </div>
  );
}
