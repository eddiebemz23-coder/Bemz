import type { z, ZodTypeAny } from 'zod';

type RawParams = Record<string, string | string[] | undefined>;

/**
 * URL search params straight from a server component are `string | string[]`, while every
 * filter schema here coerces strings and carries defaults. Rather than re-implement the
 * defaults per page, the same schema the REST route uses validates the query here too, so
 * `/search?sort=price_asc` cannot drift from what `GET /api/products` accepts.
 *
 * A bad value (`?page=abc`, a repeated key) falls back to the schema's own defaults instead of
 * failing the page: a buyer who mistyped a URL should still land on a working listing grid.
 */
export function parseParams<T extends ZodTypeAny>(schema: T, params: RawParams): z.output<T> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') flat[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') flat[key] = value[0];
  }

  const parsed = schema.safeParse(flat);
  if (parsed.success) return parsed.data as z.output<T>;

  const bare = schema.safeParse({});
  if (bare.success) return bare.data as z.output<T>;
  throw parsed.error;
}

/** Keeps the current filters and swaps one key — used by sort links, facet chips and pagination. */
export function hrefWith(
  pathname: string,
  params: Record<string, string | number | undefined>,
  overrides: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}
