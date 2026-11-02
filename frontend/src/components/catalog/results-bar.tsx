import Link from 'next/link';
import { X } from 'lucide-react';
import { SORT_OPTIONS, attributeHref, facetHref, parseAttributes, type SearchQuery } from '@/lib/search-url';
import { cn } from '@/lib/cn';

/**
 * The line above a listing grid: what is currently filtered out, and the sort.
 *
 * Sort is a row of links rather than a `<select>` — a select that changes the URL needs an
 * onchange handler, and a buyer whose page never finished hydrating would have no way to sort.
 */
export function ResultsBar({
  pathname,
  query,
  total,
  lockCategory = false,
  lockShop = false,
}: {
  pathname: string;
  query: SearchQuery;
  total: number;
  /** On a category page the category is the page, so it is not offered as a removable chip. */
  lockCategory?: boolean;
  /** Same rule for a shop page: the stall is the page, not a filter you can drop. */
  lockShop?: boolean;
}) {
  const active: { label: string; href: string }[] = [];

  if (query.q) active.push({ label: `“${query.q}”`, href: facetHref(pathname, query, { q: undefined }) });
  if (query.brand) active.push({ label: query.brand, href: facetHref(pathname, query, { brand: undefined }) });
  if (!lockCategory && query.categorySlug)
    active.push({ label: query.categorySlug, href: facetHref(pathname, query, { categorySlug: undefined }) });
  if (!lockShop && query.shopSlug)
    active.push({ label: `Shop: ${query.shopSlug}`, href: facetHref(pathname, query, { shopSlug: undefined }) });
  if (query.minPrice != null)
    active.push({ label: `from ${query.minPrice.toLocaleString()}`, href: facetHref(pathname, query, { minPrice: undefined }) });
  if (query.maxPrice != null)
    active.push({ label: `up to ${query.maxPrice.toLocaleString()}`, href: facetHref(pathname, query, { maxPrice: undefined }) });
  if (query.minRating != null)
    active.push({ label: `${query.minRating}★ and up`, href: facetHref(pathname, query, { minRating: undefined }) });

  for (const [name, value] of Object.entries(parseAttributes(query.attributes))) {
    active.push({ label: `${name}: ${value}`, href: attributeHref(pathname, query, name, value) });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600">
          <span className="font-semibold text-ink-900">{total.toLocaleString()}</span>{' '}
          {total === 1 ? 'item' : 'items'}
        </p>

        <nav className="flex flex-wrap items-center gap-1" aria-label="Sort results">
          {SORT_OPTIONS.map((option) => (
            <Link
              key={option.value}
              href={facetHref(pathname, query, { sort: option.value })}
              aria-current={query.sort === option.value ? 'true' : undefined}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium transition-colors',
                query.sort === option.value ? 'bg-bemz-50 text-bemz-800' : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800',
              )}
            >
              {option.label}
            </Link>
          ))}
        </nav>
      </div>

      {active.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {active.map((chip) => (
            <li key={chip.href}>
              <Link
                href={chip.href}
                className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2.5 py-1 text-xs text-ink-700 hover:bg-clay-50 hover:text-clay-800"
              >
                {chip.label}
                <X className="size-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
