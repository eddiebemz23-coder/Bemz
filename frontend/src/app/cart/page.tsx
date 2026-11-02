'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, Lock, Tag, Trash2 } from 'lucide-react';
import { useCart } from '@/lib/client/cart-store';
import type { CurrencyCode } from '@/lib/money';
import type { CartLine, CartView } from '@/lib/client/types';
import { money } from '@/lib/client/format';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkButton } from '@/components/ui/link-button';
import { ListingImage } from '@/components/ui/listing-image';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * `GET /cart`
 *
 * The basket is split by stall because checkout makes one order per shop — a buyer filling an
 * order from Kampala and a second from Nairobi sees two delivery prices, not one invented
 * average. Everything here is the server's own `CartView`; no total is computed in the browser.
 */
export default function CartPage() {
  const { cart, ready, busy, setQuantity, setSelected, selectAll, remove, clear } = useCart();
  const toast = useToast();

  if (!ready) {
    return (
      <div className="container-page space-y-4 py-6">
        <Skeleton className="h-8 w-40" />
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!cart || cart.lines.length === 0) {
    return (
      <div className="container-page py-10">
        <EmptyState
          title="Your basket is empty"
          description="Items you add stay on this phone until you sign in — then they follow you to every device."
          icon={<Trash2 className="size-7" />}
          action={<LinkButton href="/search">Start shopping</LinkButton>}
        />
      </div>
    );
  }

  const currency = cart.currency ?? 'UGX';
  const groups = groupByShop(cart.lines);
  const allSelected = cart.lines.every((line) => line.selected);

  return (
    <div className="container-page space-y-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-950">Basket</h1>
          <p className="mt-1 text-sm text-ink-600">
            {cart.itemCount} {cart.itemCount === 1 ? 'item' : 'items'} from {groups.length}{' '}
            {groups.length === 1 ? 'shop' : 'shops'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={busy}
              onChange={(event) => void selectAll(event.target.checked)}
              className="size-4 rounded border-ink-300 text-bemz-600 focus:ring-bemz-500"
            />
            Select all
          </label>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              void clear();
              toast.push('Basket emptied', 'info');
            }}
          >
            Empty basket
          </Button>
        </div>
      </header>

      {cart.blockedLines > 0 && (
        <p className="flex items-start gap-2 rounded-card bg-clay-50 px-4 py-3 text-sm text-clay-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {cart.blockedLines} {cart.blockedLines === 1 ? 'line cannot' : 'lines cannot'} be ordered right now — the
          seller may have sold out or paused the listing. Uncheck it and checkout will work.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.shopSlug} className="card overflow-hidden">
              <div className="flex items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-2.5">
                <Link
                  href={`/shop/${group.shopSlug}`}
                  className="truncate text-sm font-semibold text-ink-900 hover:text-bemz-700"
                >
                  {group.shopName}
                </Link>
                <span className="shrink-0 text-xs text-ink-500">
                  Ships from this seller · {money(group.selectedSubtotalMinor, group.currency)} selected
                </span>
              </div>

              <ul className="divide-y divide-ink-200">
                {group.lines.map((line) => (
                  <li key={line.itemId} className="flex gap-3 p-4">
                    <input
                      type="checkbox"
                      aria-label={`Include ${line.productTitle} in this order`}
                      checked={line.selected}
                      disabled={busy || line.isOutOfStock}
                      onChange={(event) => void setSelected(line.itemId, event.target.checked)}
                      className="mt-1 size-4 shrink-0 rounded border-ink-300 text-bemz-600 focus:ring-bemz-500"
                    />

                    <Link
                      href={`/product/${line.shopSlug}/${line.productSlug}`}
                      className="size-20 shrink-0 overflow-hidden rounded-lg"
                    >
                      <ListingImage src={line.imageUrl} alt={line.productTitle} className="size-full" sizes="80px" />
                    </Link>

                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/product/${line.shopSlug}/${line.productSlug}`}
                        className="line-clamp-2 text-sm font-medium text-ink-900 hover:text-bemz-700"
                      >
                        {line.productTitle}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {line.variantName} · {line.sku}
                      </p>

                      {line.priceChanged && (
                        <p className="mt-1 text-xs font-medium text-clay-700">
                          Price moved since you added it — now {money(line.unitPriceMinor, line.currency)} each.
                        </p>
                      )}
                      {line.isOutOfStock && (
                        <p className="mt-1 text-xs font-medium text-clay-700">Out of stock at this seller.</p>
                      )}
                      {!line.isOutOfStock && line.exceedsStock && (
                        <p className="mt-1 text-xs font-medium text-clay-700">
                          Only {line.availableStock} left — reduce the quantity to order.
                        </p>
                      )}
                      {line.exceedsMaxPerOrder && line.maxQuantityPerOrder != null && (
                        <p className="mt-1 text-xs font-medium text-clay-700">
                          Limit is {line.maxQuantityPerOrder} per order.
                        </p>
                      )}

                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <QuantityStepper
                          value={line.quantity}
                          disabled={busy || line.isOutOfStock}
                          max={Math.max(1, Math.min(line.availableStock || 1, line.maxQuantityPerOrder ?? 999))}
                          onChange={(next) => void setQuantity(line.itemId, next)}
                        />
                        <span className="tabular text-sm font-semibold text-clay-600">
                          {money(line.lineTotalMinor, line.currency)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            void remove(line.itemId);
                            toast.push('Removed from basket', 'info');
                          }}
                          className="inline-flex items-center gap-1 text-xs text-ink-500 hover:text-clay-700"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          Remove
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <div className="card space-y-3 p-4">
            <h2 className="font-semibold text-ink-900">Summary</h2>
            <dl className="space-y-1.5 text-sm">
              <Row label="Basket total" value={money(cart.subtotalMinor, currency)} />
              <Row label="Selected for this order" value={money(cart.selectedSubtotalMinor, currency)} strong />
            </dl>
            <p className="text-xs text-ink-500">
              Delivery is priced by district on the next step, so it is not in this total yet. Prices include VAT
              where it applies.
            </p>
            <CouponField cart={cart} busy={busy} />
            <LinkButton
              href="/checkout"
              block
              className={cart.selectedCount === 0 ? 'pointer-events-none opacity-60' : undefined}
              prefetch={false}
            >
              <Lock className="size-4" />
              Checkout ({cart.selectedCount} {cart.selectedCount === 1 ? 'item' : 'items'})
            </LinkButton>
            {cart.isGuest && (
              <p className="text-xs text-ink-500">
                <Link href="/login?callbackUrl=%2Fcart" className="font-medium text-bemz-700 hover:underline">
                  Sign in
                </Link>{' '}
                so this basket is not lost when you change phones.
              </p>
            )}
          </div>

          <p className="px-1 text-xs leading-relaxed text-ink-500">
            Pay with MTN Mobile Money, Airtel Money, card or cash on delivery where your district allows it.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className={strong ? 'tabular font-semibold text-ink-900' : 'tabular text-ink-800'}>{value}</dd>
    </div>
  );
}

function CouponField({ cart, busy }: { cart: CartView; busy: boolean }) {
  const { applyCoupon, removeCoupon } = useCart();
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  if (cart.couponCode) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg bg-bemz-50 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-bemz-800">
          <Tag className="size-3.5" aria-hidden />
          {cart.couponCode}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            void removeCoupon();
            setMessage(null);
          }}
          className="text-xs text-ink-600 hover:text-clay-700"
        >
          Remove
        </button>
      </div>
    );
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void applyCoupon(code.trim().toUpperCase()).then((result) => {
          setMessage(result.message);
          if (result.ok) setCode('');
        });
      }}
    >
      <label className="field-label" htmlFor="coupon">
        Promo code
      </label>
      <div className="flex gap-2">
        <input
          id="coupon"
          value={code}
          onChange={(event) => {
            setCode(event.target.value.toUpperCase());
            setMessage(null);
          }}
          placeholder="BEMZ10"
          className="field-input"
        />
        <Button type="submit" variant="outline" disabled={busy || code.trim().length < 3}>
          Apply
        </Button>
      </div>
      {message && (
        <p className={cart.couponCode ? 'text-xs text-bemz-700' : 'text-xs text-clay-700'} role="status">
          {message}
        </p>
      )}
    </form>
  );
}

function groupByShop(lines: CartLine[]) {
  const groups: {
    shopSlug: string;
    shopName: string;
    currency: CurrencyCode;
    selectedSubtotalMinor: number;
    lines: CartLine[];
  }[] = [];

  for (const line of lines) {
    const existing = groups.find((group) => group.shopSlug === line.shopSlug);
    if (existing) {
      existing.lines.push(line);
      if (line.selected) existing.selectedSubtotalMinor += line.lineTotalMinor;
    } else {
      groups.push({
        shopSlug: line.shopSlug,
        shopName: line.shopName,
        currency: line.currency,
        selectedSubtotalMinor: line.selected ? line.lineTotalMinor : 0,
        lines: [line],
      });
    }
  }

  return groups;
}
