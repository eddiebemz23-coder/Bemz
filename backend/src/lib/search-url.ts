import { z } from 'zod';
import { isJsonObjectString } from '@/lib/validation/common';

/**
 * The URL shape for every listing grid on the site (`/search`, `/category/[slug]`, `/shop/[slug]`).
 *
 * It deliberately does not look like the API: a buyer types `50000`, not `5000000` minor units,
 * and `?inStockOnly=true` has to survive being pasted into WhatsApp. `toProductQuery` is the one
 * place that translates the address bar into what `listPublicProducts` actually takes, so the
 * storefront and `GET /api/products` cannot drift apart on price scale or sort names.
 */

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'popular', label: 'Most sold' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Best rated' },
] as const;

export type SearchSort = (typeof SORT_OPTIONS)[number]['value'];

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === '' ? undefined : value));

/**
 * A number input the buyer left blank still submits an empty string, which coerces to 0. Zero is
 * never a real filter here — "min price 0" and "any rating" are the same query — so both map back
 * to unset instead of putting `?minPrice=0` in every link.
 */
const optionalAmount = z
  .coerce.number()
  .nonnegative()
  .finite()
  .optional()
  .transform((value) => (value === 0 ? undefined : value));

export const searchQuerySchema = z.object({
  q: text(120),
  categorySlug: text(120),
  shopSlug: text(120),
  brand: text(80),  /** JSONB containment on variant attributes, e.g. `{"Colour":"Black"}` — the "popular specs" facets. */
  attributes: z
    .string()
    .max(400)
    .optional()
    .refine(isJsonObjectString, 'attributes must be a JSON object')
    .transform((value) => (value === '' ? undefined : value)),
  /** Major units — what the buyer types. Multiplied by 100 for the API. */
  minPrice: optionalAmount,
  maxPrice: optionalAmount,
  inStockOnly: z.enum(['true', 'false']).default('true'),
  minRating: z.coerce
    .number()
    .min(0)
    .max(5)
    .optional()
    .transform((value) => (value === 0 ? undefined : value)),
  sort: z.enum(SORT_OPTIONS.map((option) => option.value) as [SearchSort, ...SearchSort[]]).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(60).default(20),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const DEFAULT_SEARCH_QUERY: SearchQuery = searchQuerySchema.parse({});

/** The Minor Unit multiplier for every currency Bemz prices in (UGX, KES and USD all use 2). */
const MINOR_PER_MAJOR = 100;

export function parseSearchQuery(raw: Record<string, string | string[] | undefined>): SearchQuery {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') flat[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') flat[key] = value[0];
  }

  const parsed = searchQuerySchema.safeParse(flat);
  if (parsed.success) return parsed.data;
  // A mistyped URL still has to show a grid; the only sane answer is the unfiltered first page.
  return DEFAULT_SEARCH_QUERY;
}

export interface PublicProductQuery {
  q?: string;
  categorySlug?: string;
  shopSlug?: string;
  brand?: string;
  attributes?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  inStockOnly: 'true' | 'false';
  minRating?: number;
  sort: SearchSort;
  page: number;
  perPage: number;
}

export function toProductQuery(query: SearchQuery): PublicProductQuery {
  return {
    q: query.q,
    categorySlug: query.categorySlug,
    shopSlug: query.shopSlug,
    brand: query.brand,
    attributes: query.attributes,
    minPriceMinor: query.minPrice === undefined ? undefined : Math.round(query.minPrice * MINOR_PER_MAJOR),
    maxPriceMinor: query.maxPrice === undefined ? undefined : Math.round(query.maxPrice * MINOR_PER_MAJOR),
    inStockOnly: query.inStockOnly,
    minRating: query.minRating,
    sort: query.sort,
    page: query.page,
    perPage: query.perPage,
  };
}

/** The URL form of a query, with `overrides` applied — empty values are dropped, not sent. */
export function searchHref(pathname: string, query: SearchQuery, overrides: Partial<SearchQuery> = {}): string {
  const merged: SearchQuery = { ...query, ...overrides };
  const search = new URLSearchParams();

  const put = (key: string, value: string | number | undefined, dropIf?: string | number) => {
    if (value === undefined || value === '' || value === dropIf) return;
    search.set(key, String(value));
  };

  put('q', merged.q);
  put('categorySlug', merged.categorySlug);
  put('shopSlug', merged.shopSlug);
  put('brand', merged.brand);
  put('attributes', merged.attributes);
  put('minPrice', merged.minPrice);
  put('maxPrice', merged.maxPrice);
  put('minRating', merged.minRating);
  put('sort', merged.sort, DEFAULT_SEARCH_QUERY.sort);
  put('inStockOnly', merged.inStockOnly, DEFAULT_SEARCH_QUERY.inStockOnly);
  put('page', merged.page, 1);

  const value = search.toString();
  return value ? `${pathname}?${value}` : pathname;
}

/** A facet link that replaces the current page, e.g. tapping a brand from the sidebar. */
export function facetHref(pathname: string, query: SearchQuery, facet: Partial<SearchQuery>): string {
  return searchHref(pathname, query, { ...facet, page: 1 });
}

/** Back into the form's inputs: the API speaks minor units, the buyer speaks shillings. */
export function majorFromMinor(minor: number | null | undefined, fallback = ''): string {
  if (minor == null) return fallback;
  const major = minor / MINOR_PER_MAJOR;
  return String(Number.isInteger(major) ? major : Number(major.toFixed(2)));
}

export function parseAttributes(raw?: string): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' || typeof entry[1] === 'number',
      ),
    );
  } catch {
    return {};
  }
}

/**
 * Tapping a spec toggles it: `Colour=Black` then `Colour=White` swaps the value instead of
 * asking the buyer for a result set no seller has ever stocked.
 */
export function attributeHref(pathname: string, query: SearchQuery, name: string, value: string): string {
  const current = parseAttributes(query.attributes);
  const next: Record<string, string> = { ...current };
  if (current[name] === value) delete next[name];
  else next[name] = value;

  return facetHref(pathname, query, { attributes: Object.keys(next).length > 0 ? JSON.stringify(next) : undefined });
}
