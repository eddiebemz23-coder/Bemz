'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import { api, ApiFailure } from '@/lib/client/api';
import { useCart } from '@/lib/client/cart-store';
import { useToast } from '@/components/toast';
import type { ProductCondition } from '@/lib/client/types';
import type { CurrencyCode } from '@/lib/money';
import { money } from '@/lib/client/format';
import { PriceTag } from '@/components/ui/price-tag';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Button } from '@/components/ui/button';
import { ListingImage } from '@/components/ui/listing-image';
import { DeliveryEstimate } from '@/components/product/delivery-estimate';
import { cn } from '@/lib/cn';

/**
 * Only what the buy box needs, mapped server-side.
 *
 * Passing the whole product projection to a client component would ship the description, the Q&A
 * thread and every photo into the JS payload, and `variant.attributes` arrives as a Prisma
 * `JsonValue` that the browser DTO cannot describe. This is the contract instead.
 */
export interface PurchaseModel {
  id: string;
  title: string;
  currency: CurrencyCode;
  condition: ProductCondition;
  isDigital: boolean;
  warrantyText: string | null;
  purchasable: boolean;
  startingPriceMinor: number | null;
  shop: { name: string; country: { code: string }; isOpen: boolean; dispatchSlaHours: number };
  variants: {
    id: string;
    name: string;
    priceMinor: number;
    compareAtPriceMinor: number | null;
    currency: CurrencyCode;
    isPrimary: boolean;
    availableStock: number;
    maxQuantityPerOrder: number | null;
    /** This option's own photos — a buyer who taps "Blue" wants to see the blue one. */
    images: { url: string; altText: string | null }[];
  }[];
}

/**
 * The buy box: variant, quantity, basket.
 *
 * Stock and price always come from the server's projection of the selected variant — the client
 * never trusts a number it can edit. `availableStock` is already `stockQuantity - reservedQuantity`
 * (see `toPublicProduct`), so the ceiling on the stepper is the same ceiling `addToCart` enforces.
 */
export function ProductPurchaser({
  product,
  signedIn,
  savedInitially = false,
}: {
  product: PurchaseModel;
  signedIn: boolean;
  savedInitially?: boolean;
}) {
  const router = useRouter();
  const { add } = useCart();
  const toast = useToast();

  const inStock = product.variants.filter((variant) => variant.availableStock > 0);
  const initial =
    inStock.find((variant) => variant.isPrimary) ??
    inStock[0] ??
    product.variants.find((variant) => variant.isPrimary) ??
    product.variants[0];

  const [variantId, setVariantId] = useState<string | null>(initial?.id ?? null);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(savedInitially);
  const [adding, setAdding] = useState(false);

  const variant = product.variants.find((candidate) => candidate.id === variantId) ?? null;
  const perOrderCap = variant?.maxQuantityPerOrder ?? 999;
  const maxQuantity = Math.max(1, Math.min(variant?.availableStock ?? 1, perOrderCap, 999));
  const buyable = Boolean(variant && variant.availableStock > 0 && product.purchasable && product.shop.isOpen);

  function chooseVariant(id: string) {
    setVariantId(id);
    const next = product.variants.find((candidate) => candidate.id === id);
    setQuantity(Math.min(next?.maxQuantityPerOrder ?? 1, Math.max(1, next?.availableStock ?? 1)));
  }

  async function addToBasket() {
    if (!variant) return;
    setAdding(true);
    const result = await add(variant.id, quantity);
    setAdding(false);
    toast.push(result.message, result.ok ? 'success' : 'error');
    if (result.ok) router.refresh();
  }

  async function toggleSaved() {
    if (!signedIn) {
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setSaving(true);
    try {
      if (saved) {
        await api.del(`/api/wishlist/${product.id}`);
        setSaved(false);
        toast.push('Removed from your saved items');
      } else {
        await api.post('/api/wishlist', { productId: product.id });
        setSaved(true);
        toast.push('Saved. Find it under Account.', 'success');
      }
    } catch (failure) {
      toast.push(failure instanceof ApiFailure ? failure.message : 'Could not update your saved items', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {!product.purchasable && (
        <p className="rounded-card bg-clay-50 px-3 py-2 text-sm text-clay-800">
          This listing is awaiting our review, so it cannot be bought yet. Sellers share this link to show where an
          item is in the queue.
        </p>
      )}

      {!product.shop.isOpen && (
        <p className="rounded-card bg-ink-100 px-3 py-2 text-sm text-ink-700">
          {product.shop.name} is not taking orders right now. You can still save the item.
        </p>
      )}

      <PriceTag
        amountMinor={variant?.priceMinor ?? product.startingPriceMinor ?? null}
        currency={product.currency}
        compareAtMinor={variant?.compareAtPriceMinor ?? null}
        size="lg"
        label="includes VAT where it applies"
      />

      {product.variants.length > 1 && (
        <div>
          <p className="field-label">Choose an option</p>
          <ul className="mt-1.5 flex flex-wrap gap-2">
            {product.variants.map((option) => {
              const soldOut = option.availableStock <= 0;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => !soldOut && chooseVariant(option.id)}
                    disabled={soldOut}
                    aria-pressed={option.id === variantId}
                    className={cn(
                      'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                      option.id === variantId ? 'border-bemz-600 bg-bemz-50 text-bemz-900' : 'border-ink-200 bg-white hover:border-bemz-400',
                      soldOut && 'cursor-not-allowed border-ink-100 bg-ink-50 text-ink-400 line-through',
                    )}
                  >
                    <span className="block font-medium">{option.name}</span>
                    <span className="block text-xs tabular">
                      {money(option.priceMinor, option.currency)}
                      {soldOut ? ' · sold out' : option.availableStock <= 5 ? ` · only ${option.availableStock} left` : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {variant && variant.images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {variant.images.slice(0, 4).map((image, index) => (
            <li key={`${variant.id}-${index}`}>
              <ListingImage
                src={image.url}
                alt={image.altText ?? `${variant.name} — photo ${index + 1}`}
                className="size-16 rounded-lg border border-ink-200"
                sizes="64px"
              />
            </li>
          ))}
        </ul>
      )}

      {variant && (
        <p className="text-xs text-ink-500">
          {variant.availableStock > 0
            ? `${variant.availableStock} available${perOrderCap < 999 ? ` · max ${perOrderCap} per order` : ''}`
            : 'This option is out of stock. Pick another or ask the seller when it is coming back.'}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <p className="field-label">Quantity</p>
          <QuantityStepper value={quantity} onChange={setQuantity} max={maxQuantity} disabled={!buyable} />
        </div>

        <Button size="lg" onClick={addToBasket} loading={adding} disabled={!buyable || !variant}>
          Add to basket
        </Button>

        <button
          type="button"
          onClick={toggleSaved}
          disabled={saving}
          aria-pressed={saved}
          className={cn(
            'inline-flex h-12 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors',
            saved ? 'border-clay-300 bg-clay-50 text-clay-800' : 'border-ink-200 bg-white text-ink-700 hover:border-clay-300',
          )}
        >
          <Heart className={cn('size-4', saved && 'fill-clay-500 text-clay-500')} />
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>

      <DeliveryEstimate
        variantId={variant?.id ?? null}
        country={product.shop.country.code}
        shopName={product.shop.name}
        shopClosed={!product.shop.isOpen}
      />

      <dl className="grid grid-cols-2 gap-3 text-xs text-ink-600">
        <div>
          <dt className="font-medium text-ink-800">Dispatch</dt>
          <dd>Within {product.shop.dispatchSlaHours}h of your order</dd>
        </div>
        <div>
          <dt className="font-medium text-ink-800">Condition</dt>
          <dd className="capitalize">{product.condition.replace(/_/g, ' ')}</dd>
        </div>
        {product.warrantyText && (
          <div className="col-span-2">
            <dt className="font-medium text-ink-800">Warranty</dt>
            <dd>{product.warrantyText}</dd>
          </div>
        )}
        {product.isDigital && (
          <div className="col-span-2">
            <dt className="font-medium text-ink-800">Delivery</dt>
            <dd>Digital item — sent to your phone or email after payment, nothing to ship.</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
