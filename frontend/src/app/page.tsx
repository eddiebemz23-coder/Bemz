import Link from 'next/link';
import { Truck, ShieldCheck, Store, Star } from 'lucide-react';
import { categoryTree } from '@/lib/services/categories';
import { listPublicProducts } from '@/lib/services/products';
import { listPublicShops } from '@/lib/services/shops';
import { ProductCard, ProductRail } from '@/components/product-card';
import { ShopCardTile } from '@/components/shop-card';
import { ListingImage } from '@/components/ui/listing-image';
import { LinkButton } from '@/components/ui/link-button';

/**
 * The storefront home.
 *
 * Revalidated rather than rendered per request: the four queries below are the hottest reads in
 * the system, two minutes of staleness on a "trending" rail costs nothing, and a buyer on a
 * congested Kampala cell tower gets a page that is already on the CDN.
 */
export const revalidate = 120;

const TRENDING = { sort: 'popular', page: 1, perPage: 12, inStockOnly: 'true' } as const;
const FRESH = { sort: 'newest', page: 1, perPage: 12, inStockOnly: 'true' } as const;

export default async function HomePage() {
  const [departments, trending, fresh, shops] = await Promise.all([
    categoryTree({}),
    listPublicProducts(TRENDING),
    listPublicProducts(FRESH),
    listPublicShops({ page: 1, perPage: 6 }),
  ]);

  return (
    <div className="space-y-10 pb-12">
      <section className="bg-gradient-to-b from-bemz-50 to-ink-50">
        <div className="container-page grid gap-8 py-10 sm:py-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-bemz-700 shadow-card">
              <Truck className="size-3.5" />
              Delivery priced by district, from Kampala to Kisoro
            </p>
            <h1 className="mt-4 text-3xl font-extrabold leading-tight text-ink-950 sm:text-4xl">
              Buy from traders near you.
              <span className="block text-bemz-700">Pay with MoMo, Airtel Money or cash.</span>
            </h1>
            <p className="mt-4 max-w-xl text-base text-ink-600">
              Bemz is a marketplace for Uganda and Kenya: real shops, prices in shillings that already
              include VAT, and a rider who brings the parcel to your parish instead of a pickup point across town.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <LinkButton href="/search?sort=popular" size="lg">
                Start shopping
              </LinkButton>
              <LinkButton href="/register?role=seller" variant="outline" size="lg">
                <Store className="size-4" />
                Open a shop
              </LinkButton>
            </div>
            <dl className="mt-7 grid max-w-lg grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-ink-500">Pay</dt>
                <dd className="font-semibold text-ink-900">MTN · Airtel · Card</dd>
              </div>
              <div>
                <dt className="text-ink-500">Markets</dt>
                <dd className="font-semibold text-ink-900">UGX · KES</dd>
              </div>
              <div>
                <dt className="text-ink-500">Verified sellers</dt>
                <dd className="font-semibold text-ink-900">KYC checked</dd>
              </div>
            </dl>
          </div>

          {trending.items[0] && (
            <Link
              href={`/product/${trending.items[0].shop.slug}/${trending.items[0].slug}`}
              className="card overflow-hidden"
            >
              <ListingImage
                src={trending.items[0].imageUrl}
                alt={trending.items[0].title}
                priority
                className="aspect-[4/3] w-full"
                sizes="(min-width: 1024px) 40vw, 100vw"
              />
              <div className="flex items-center gap-2 p-4">
                <Star className="size-4 shrink-0 fill-clay-400 text-clay-500" />
                <p className="text-sm font-medium text-ink-900">Selling fastest right now: {trending.items[0].title}</p>
              </div>
            </Link>
          )}
        </div>
      </section>

      <section className="container-page space-y-4">
        <h2 className="text-lg font-bold text-ink-900">Shop by department</h2>
        {departments.length === 0 ? (
          <p className="text-sm text-ink-500">
            Departments are still being set up. <Link href="/search" className="text-bemz-700 hover:underline">Browse everything</Link>.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {departments.map((department) => (
              <Link
                key={department.id}
                href={`/category/${department.slug}`}
                className="card flex flex-col items-center gap-2 p-3 text-center transition-shadow hover:shadow-raised"
              >
                <ListingImage
                  src={department.imageUrl}
                  alt={department.name}
                  className="aspect-square w-full rounded-md"
                  sizes="(min-width: 1024px) 10vw, 28vw"
                />
                <span className="line-clamp-2 text-xs font-medium text-ink-800">{department.name}</span>
                <span className="text-[11px] text-ink-500">{department.productCount} items</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {trending.items.length > 0 && (
        <section className="container-page">
          <ProductRail title="Trending this week" href="/search?sort=popular">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {trending.items.slice(0, 12).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </ProductRail>
        </section>
      )}

      {shops.items.length > 0 && (
        <section className="container-page space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-bold text-ink-900">Shops buyers keep coming back to</h2>
            <Link href="/shops" className="text-sm font-medium text-bemz-700 hover:underline">
              All shops
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shops.items.slice(0, 6).map((shop) => (
              <ShopCardTile key={shop.id} shop={shop} />
            ))}
          </div>
        </section>
      )}

      {fresh.items.length > 0 && (
        <section className="container-page">
          <ProductRail title="Just listed" href="/search?sort=newest">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {fresh.items.slice(0, 12).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </ProductRail>
        </section>
      )}

      <section className="container-page">
        <div className="card grid gap-4 p-6 sm:grid-cols-3">
          <div className="flex gap-3">
            <ShieldCheck className="size-6 shrink-0 text-bemz-600" />
            <div>
              <p className="font-semibold text-ink-900">Money held until it arrives</p>
              <p className="mt-1 text-sm text-ink-600">
                Mobile money settlements are matched against the order. A parcel that never lands gets refunded.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Truck className="size-6 shrink-0 text-bemz-600" />
            <div>
              <p className="font-semibold text-ink-900">Priced by zone, not by guesswork</p>
              <p className="mt-1 text-sm text-ink-600">
                Delivery fees and the number of days are set per zone, so Gulu and Kampala are not quoted the same promise.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Store className="size-6 shrink-0 text-bemz-600" />
            <div>
              <p className="font-semibold text-ink-900">Sellers we can find</p>
              <p className="mt-1 text-sm text-ink-600">
                Shops that want the verified badge submit a trading licence and national ID. We read them before listing them.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
