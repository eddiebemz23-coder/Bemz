import Link from 'next/link';
import type { ProductListItem } from '@/lib/client/types';
import { cn } from '@/lib/cn';
import { ListingImage } from '@/components/ui/listing-image';
import { PriceTag } from '@/components/ui/price-tag';
import { Stars } from '@/components/ui/stars';

export function ProductCard({ product, priority = false }: { product: ProductListItem; priority?: boolean }) {
  const soldOut = product.availableStock <= 0;

  return (
    <Link
      href={`/product/${product.shop.slug}/${product.slug}`}
      className={cn(
        'card group flex flex-col overflow-hidden transition-shadow hover:shadow-raised',
        soldOut && 'opacity-70',
      )}
    >
      <div className="relative">
        <ListingImage
          src={product.thumbImageUrl ?? product.imageUrl}
          alt={product.title}
          priority={priority}
          className="aspect-square w-full"
          sizes="(min-width: 1280px) 16vw, (min-width: 768px) 20vw, (min-width: 480px) 33vw, 50vw"
        />
        {product.discountPct != null && product.discountPct > 0 && (
          <span className="absolute left-2 top-2 rounded bg-clay-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
            -{Math.round(product.discountPct)}%
          </span>
        )}
        {soldOut && (
          <span className="absolute inset-x-0 bottom-0 bg-ink-950/70 py-1 text-center text-xs font-semibold text-white">
            Sold out
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="line-clamp-2 text-sm font-medium leading-snug text-ink-900 group-hover:text-bemz-700">
          {product.title}
        </h3>
        <PriceTag
          amountMinor={product.startingPriceMinor}
          currency={product.currency}
          compareAtMinor={product.compareAtPriceMinor}
          size="md"
        />
        <div className="mt-auto flex items-center gap-1.5 text-xs text-ink-500">
          <Stars value={product.ratingAvg} />
          {product.ratingCount > 0 && <span>({product.ratingCount})</span>}
          {product.soldCount > 0 && <span>· {product.soldCount} sold</span>}
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="truncate text-[11px] text-ink-500">{product.shop.name}</span>
          {product.availableStock > 0 && product.availableStock <= 5 && (
            <span className="shrink-0 text-[11px] font-medium text-clay-600">Only {product.availableStock} left</span>
          )}
        </div>
      </div>
    </Link>
  );
}

/** Horizontal rails on the homepage scroll sideways instead of stacking into an endless page. */
export function ProductRail({ title, href, linkLabel = 'See all', children }: { title: string; href?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-bold text-ink-900">{title}</h2>
        {href && (
          <Link href={href} className="text-sm font-medium text-bemz-700 hover:underline">
            {linkLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
