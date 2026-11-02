import type { Metadata } from 'next';
import Link from 'next/link';
import { Store } from 'lucide-react';
import { listPublicShops } from '@/lib/services/shops';
import { shopQuerySchema } from '@/lib/validation/catalog';
import { parseParams } from '@/lib/catalog-params';
import { REGION_LIST } from '@/lib/client/regions';
import { buttonClasses } from '@/components/ui/button-styles';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkButton } from '@/components/ui/link-button';
import { Pagination } from '@/components/ui/pagination';
import { ShopCardTile } from '@/components/shop-card';

/**
 * `GET /shops`
 *
 * Every stall in the market, sorted the way a buyer sorts a market: verified sellers with real
 * delivered orders first. Filters are a `<form method="get">`, so narrowing to Kenyan shops works
 * on a handset that never finished hydrating.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Shops — Uganda and Kenya',
  description:
    'Browse verified sellers on Bemz Africa: shops in Kampala, Wakiso, Nairobi and Mombasa with delivery priced by district.',
};

interface Props {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function ShopsPage({ searchParams }: Props) {
  const query = parseParams(shopQuerySchema, searchParams);
  const result = await listPublicShops(query);

  const shopsHref = (page: number) => {
    const search = new URLSearchParams();
    if (query.q) search.set('q', query.q);
    if (query.country) search.set('country', query.country);
    if (query.verifiedOnly === 'true') search.set('verifiedOnly', 'true');
    if (page > 1) search.set('page', String(page));
    const value = search.toString();
    return value ? `/shops?${value}` : '/shops';
  };

  return (
    <div className="container-page space-y-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-950">Shops</h1>
          <p className="mt-1 text-sm text-ink-600">
            <span className="font-semibold text-ink-900">{result.total.toLocaleString()}</span>{' '}
            {result.total === 1 ? 'seller' : 'sellers'} open for orders
          </p>
        </div>
        <LinkButton href="/register?role=seller" variant="outline" size="sm">
          <Store className="size-4" />
          Open a shop
        </LinkButton>
      </header>

      <form method="get" action="/shops" className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-52 flex-1">
          <label className="field-label" htmlFor="shops-q">
            Find a seller
          </label>
          <input
            id="shops-q"
            name="q"
            type="search"
            defaultValue={query.q ?? ''}
            placeholder="Shop name, or something they sell"
            className="field-input"
          />
        </div>

        <div className="w-40">
          <label className="field-label" htmlFor="shops-country">
            Country
          </label>
          <select id="shops-country" name="country" defaultValue={query.country ?? ''} className="field-input">
            <option value="">Both markets</option>
            {REGION_LIST.map((region) => (
              <option key={region.code} value={region.code}>
                {region.name}
              </option>
            ))}
          </select>
        </div>

        <div className="w-44">
          <label className="field-label" htmlFor="shops-verified">
            Trust level
          </label>
          <select id="shops-verified" name="verifiedOnly" defaultValue={query.verifiedOnly ?? 'false'} className="field-input">
            <option value="false">Any seller</option>
            <option value="true">Verified sellers only</option>
          </select>
        </div>

        <button type="submit" className={buttonClasses({})}>
          Apply
        </button>
        <Link href="/shops" className="pb-2 text-sm text-ink-500 hover:text-clay-700">
          Clear
        </Link>
      </form>

      {result.items.length === 0 ? (
        <EmptyState
          title="No shop matches that"
          description="Try a shorter word — sellers are also found by what they list, so “phones” finds a stall that sells phones."
          action={
            <Link href="/shops" className="text-sm font-medium text-bemz-700 hover:underline">
              See every shop
            </Link>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {result.items.map((shop) => (
            <li key={shop.id}>
              <ShopCardTile shop={shop} className="h-full" />
            </li>
          ))}
        </ul>
      )}

      <Pagination page={result.page} perPage={result.perPage} total={result.total} hrefFor={shopsHref} />
    </div>
  );
}
