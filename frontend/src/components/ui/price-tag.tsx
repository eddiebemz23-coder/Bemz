import type { CurrencyCode } from '@/lib/money';
import { cn } from '@/lib/cn';
import { money } from '@/lib/client/format';

/**
 * Advertised prices are VAT-inclusive in both markets, so the figure shown is the figure
 * charged — the tax is only ever broken out on the receipt, never added here.
 */
export function PriceTag({
  amountMinor,
  currency,
  compareAtMinor,
  discountPct,
  label,
  size = 'md',
  className,
}: {
  amountMinor: number | null;
  currency: CurrencyCode;
  compareAtMinor?: number | null;
  discountPct?: number | null;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const current = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' }[size];

  if (amountMinor == null) {
    return <span className={cn('text-sm text-ink-400', className)}>Price on request</span>;
  }

  const off =
    discountPct && discountPct > 0
      ? `-${Math.round(discountPct)}%`
      : compareAtMinor && compareAtMinor > amountMinor
        ? `-${Math.round(((compareAtMinor - amountMinor) / compareAtMinor) * 100)}%`
        : null;

  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
      <span className={cn('tabular font-semibold text-clay-600', current)}>{money(amountMinor, currency)}</span>
      {compareAtMinor && compareAtMinor > amountMinor && (
        <span className="tabular text-xs text-ink-400 line-through">{money(compareAtMinor, currency)}</span>
      )}
      {off && <span className="rounded bg-clay-100 px-1.5 py-0.5 text-[11px] font-bold text-clay-700">{off}</span>}
      {label && <span className="text-xs text-ink-500">{label}</span>}
    </div>
  );
}
