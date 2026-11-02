import Link from 'next/link';
import type { CurrencyCode } from '@/lib/money';
import type { categoryLanding } from '@/lib/services/categories';
import {
  DEFAULT_SEARCH_QUERY,
  attributeHref,
  facetHref,
  majorFromMinor,
  parseAttributes,
  type SearchQuery,
} from '@/lib/search-url';
import { buttonClasses } from '@/components/ui/button-styles';

type Facets = Awaited<ReturnType<typeof categoryLanding>>['facets'];

/**
 * Listing-grid filters.
 *
 * This is a plain `<form method="get">` plus links, so a buyer on a Nokia-grade handset filters
 * a category with no JavaScript at all: the browser builds the query string, the server renders
 * the grid. Nothing here needs hydration to work.
 */
export function SearchFilters({
  pathname,
  query,
  currency,
  facets,
}: {
  pathname: string;
  query: SearchQuery;
  currency: CurrencyCode;
  facets?: Facets | null;
}) {
  // `q` and `brand` are real inputs in this form; mirroring them as hidden fields would make the
  // browser send the stale URL value first and the page would ignore what the buyer just typed.
  const hidden: Record<string, string | undefined> = {
    categorySlug: query.categorySlug,
    shopSlug: query.shopSlug,
    attributes: query.attributes,
    sort: query.sort === DEFAULT_SEARCH_QUERY.sort ? undefined : query.sort,
  };

  const selectedAttributes = parseAttributes(query.attributes);
  const priceBand = facets?.priceBands.find((band) => band.currency === currency) ?? null;

  return (
    <div className="space-y-6">
      <form method="get" action={pathname} className="space-y-4">
        {Object.entries(hidden).map(([name, value]) =>
          value ? <input key={name} type="hidden" name={name} value={value} /> : null,
        )}

        <div>
          <label className="field-label" htmlFor="filter-q">
            Search within
          </label>
          <input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={query.q ?? ''}
            placeholder="matooke, phone, cement"
            className="field-input"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="filter-min">
              Min {shillingLabel(currency)}
            </label>
            <input
              id="filter-min"
              name="minPrice"
              type="number"
              min={0}
              step={100}
              inputMode="numeric"
              defaultValue={query.minPrice ?? ''}
              className="field-input"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="filter-max">
              Max {shillingLabel(currency)}
            </label>
            <input
              id="filter-max"
              name="maxPrice"
              type="number"
              min={0}
              step={100}
              inputMode="numeric"
              defaultValue={query.maxPrice ?? ''}
              className="field-input"
            />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="filter-stock">
            Availability
          </label>
          <select id="filter-stock" name="inStockOnly" defaultValue={query.inStockOnly} className="field-input">
            <option value="false">Show sold-out items too</option>
            <option value="true">In stock only</option>
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="filter-rating">
            Buyer rating
          </label>
          <select id="filter-rating" name="minRating" defaultValue={query.minRating ?? ''} className="field-input">
            <option value="">Any rating</option>
            <option value="3">3 stars and up</option>
            <option value="4">4 stars and up</option>
            <option value="4.5">4.5 stars and up</option>
          </select>
        </div>

        <div>
          <label className="field-label" htmlFor="filter-brand">
            Brand
          </label>
          <input
            id="filter-brand"
            name="brand"
            type="search"
            defaultValue={query.brand ?? ''}
            placeholder="Samsung, Safaricom…"
            className="field-input"
          />
          {facets && facets.brands.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {facets.brands.slice(0, 10).map((brand) => (
                <li key={brand.brand}>
                  <Link
                    href={facetHref(pathname, query, { brand: brand.brand === query.brand ? undefined : brand.brand })}
                    className={chip(query.brand === brand.brand)}
                  >
                    {brand.brand} ({brand.count})
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="submit" className={buttonClasses({ block: true })}>
          Apply filters
        </button>
        <Link href={pathname} className="block text-center text-sm text-ink-500 hover:text-clay-700">
          Clear everything
        </Link>
      </form>

      {priceBand && (
        <div>
          <p className="field-label">Price in this category</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[0.25, 0.5, 0.75].map((ratio) => {
              const cap = Math.round(priceBand.minMinor + (priceBand.maxMinor - priceBand.minMinor) * ratio);
              const major = Number(majorFromMinor(cap));
              const active = query.maxPrice === major;
              return (
                <Link
                  key={ratio}
                  href={facetHref(pathname, query, { maxPrice: active ? undefined : major })}
                  className={chip(active)}
                >
                  Under {major.toLocaleString()} {shillingLabel(currency)}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {facets && facets.attributes.length > 0 && (
        <div className="space-y-3">
          <p className="field-label">Popular specifications</p>
          {facets.attributes.slice(0, 6).map((facet) => (
            <div key={facet.name}>
              <p className="text-xs font-medium text-ink-500">{facet.name}</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {facet.options.slice(0, 8).map((option) => (
                  <li key={option.value}>
                    <Link
                      href={attributeHref(pathname, query, facet.name, option.value)}
                      className={chip(selectedAttributes[facet.name] === option.value)}
                    >
                      {option.value} ({option.count})
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const chip = (active: boolean) =>
  `inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors ${
    active ? 'border-bemz-600 bg-bemz-50 font-semibold text-bemz-800' : 'border-ink-200 bg-white text-ink-700 hover:border-bemz-400'
  }`;

const shillingLabel = (currency: CurrencyCode) => (currency === 'KES' ? 'KSh' : currency === 'UGX' ? 'UGX' : 'USD');
