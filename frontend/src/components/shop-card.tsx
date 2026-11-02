import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import type { ShopCard } from '@/lib/client/types';
import { cn } from '@/lib/cn';
import { etaLabel } from '@/lib/client/format';
import { Stars } from '@/components/ui/stars';

export function ShopCardTile({ shop, className }: { shop: ShopCard; className?: string }) {
  return (
    <Link href={`/shop/${shop.slug}`} className={cn('card flex flex-col overflow-hidden hover:shadow-raised', className)}>
      <div className="relative h-20 w-full bg-bemz-50">
        {shop.bannerUrl && (
          // Background style, not <img>: an oversized banner decoded inside a grid of tiles is
          // memory the phone does not have to spare.
          <div
            className="h-full w-full bg-cover bg-center"
            style={{ backgroundImage: `url(${shop.bannerUrl})` }}
            aria-hidden
          />
        )}
        <span className="absolute -bottom-6 left-4 grid size-14 place-items-center overflow-hidden rounded-full border-2 border-white bg-white shadow-card">
          {shop.logoUrl ? (
            <img src={shop.logoUrl} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-lg font-bold text-bemz-700">{shop.name.slice(0, 1)}</span>
          )}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-8">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold text-ink-900">{shop.name}</h3>
          {shop.isVerified && <BadgeCheck className="size-4 shrink-0 text-bemz-600" aria-label="Verified shop" />}
        </div>
        {shop.tagline && <p className="line-clamp-2 text-xs text-ink-500">{shop.tagline}</p>}

        <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-500">
          <Stars value={shop.ratingAvg} />
          {shop.ratingCount > 0 && <span>({shop.ratingCount})</span>}
          <span>· {shop.totalSalesCount.toLocaleString()} sales</span>
        </div>

        <p className="mt-auto pt-2 text-[11px] text-ink-400">
          {shop.basedIn ? `${shop.basedIn.name}, ${shop.country.name}` : shop.country.name} ·{' '}
          {shop.vacationMode ? 'On holiday' : etaLabel(shop.basedIn?.estimatedDaysMin, shop.basedIn?.estimatedDaysMax)}
        </p>
      </div>
    </Link>
  );
}
