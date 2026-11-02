'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle, Lock, MapPin, Plus, ShieldCheck, Truck } from 'lucide-react';
import { api, ApiFailure, idempotencyKey } from '@/lib/client/api';
import { useCart } from '@/lib/client/cart-store';
import type { AddressView, CartView, CheckoutResult, ProviderList } from '@/lib/client/types';
import type { CurrencyCode } from '@/lib/money';
import { etaLabel, money } from '@/lib/client/format';
import { REGIONS, regionForCurrency } from '@/lib/client/regions';
import { PhoneInput } from '@/components/auth/phone-input';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/toast';

/**
 * `GET /checkout`
 *
 * One sheet, three server facts: the basket the buyer selected, the address book with each stop's
 * delivery zone, and the rails live for that currency. The totals come from
 * `POST /api/cart/quote` — the same `quoteBasket` the checkout runs — so the figure here is the
 * figure the MoMo prompt asks for. Nothing is added on the way to the payment.
 */

interface CheckoutSheet {
  cart: CartView;
  addresses: AddressView[];
  canCheckOut: boolean;
  blockers: string[];
}

type Phase = 'loading' | 'signed_out' | 'empty' | 'ready' | 'failed';

export default function CheckoutPage() {
  const router = useRouter();
  const toast = useToast();
  const { cart, quote, quoting, quoteFor, refresh } = useCart();

  const [phase, setPhase] = useState<Phase>('loading');
  const [sheet, setSheet] = useState<CheckoutSheet | null>(null);
  const [rail, setRail] = useState<ProviderList | null>(null);
  const [addressId, setAddressId] = useState('');
  const [provider, setProvider] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [region, setRegion] = useState<'UG' | 'KE'>('UG');
  const [buyerNote, setBuyerNote] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  // Replaying the same key after a dropped response makes the server return the orders it already
  // made; any change to what is being ordered deserves a fresh key.
  const [attemptKey, setAttemptKey] = useState(() => idempotencyKey('checkout'));

  useEffect(() => {
    api
      .get<CheckoutSheet>('/api/checkout')
      .then((data) => {
        setSheet(data);
        if (data.cart.selectedCount === 0) {
          setPhase('empty');
          return;
        }
        const preferred = data.addresses.find((address) => address.isDefault) ?? data.addresses[0];
        if (preferred) {
          setAddressId(preferred.id);
          void quoteFor(preferred.districtId, preferred.id);
        }
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof ApiFailure && error.status === 401) setPhase('signed_out');
        else if (error instanceof ApiFailure && error.status === 400) setPhase('empty');
        else setPhase('failed');
      });
    // `quoteFor` is stable per provider mount and must not re-run the sheet load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currency: CurrencyCode = quote?.currency ?? sheet?.cart.currency ?? 'UGX';

  // Only the mobile-money rails push a PIN prompt to a handset; a card never needs a number here.
  const needsPhoneFor = (option: string) => option === 'MTN_MOMO' || option === 'AIRTEL_MONEY';

  useEffect(() => {
    setRegion(regionForCurrency(currency));
  }, [currency]);

  // The rail list is personalised: an 077 number is MTN, and picking the wrong network means a PIN
  // prompt that never arrives. Re-queried as the number is typed, debounced so each keypress does
  // not cost a request.
  useEffect(() => {
    const handle = setTimeout(() => {
      const digits = payerPhone.replace(/\D/g, '');
      const query = `/api/payments/providers?currency=${currency}${
        needsPhoneFor(provider) && digits.length >= 9 ? `&payerPhone=${encodeURIComponent(payerPhone)}` : ''
      }`;
      api
        .get<ProviderList>(query)
        .then((list) => {
          setRail(list);
          setProvider((current) => {
            const chosen = list.providers.find((option) => option.provider === current && option.available);
            if (chosen) return current;
            const fallback = list.providers.find((option) => option.suggested) ?? list.providers.find((option) => option.available);
            return fallback?.provider ?? '';
          });
        })
        .catch(() => setRail(null));
    }, 450);
    return () => clearTimeout(handle);
  }, [currency, payerPhone, provider]);

  useEffect(() => {
    setAttemptKey(idempotencyKey('checkout'));
    setIssues({});
  }, [addressId, provider]);

  const selectedAddress = sheet?.addresses.find((address) => address.id === addressId) ?? null;

  async function chooseAddress(address: AddressView) {
    setAddressId(address.id);
    await quoteFor(address.districtId, address.id);
  }

  async function placeOrder() {
    if (!addressId || !provider) return;
    setSubmitting(true);
    setIssues({});
    try {
      const result = await api.post<CheckoutResult>(
        '/api/checkout',
        {
          addressId,
          paymentProvider: provider,
          payerPhone: needsPhoneFor(provider) ? payerPhone : undefined,
          buyerNote: buyerNote.trim() || undefined,
          idempotencyKey: attemptKey,
        },
        { idempotencyKey: attemptKey },
      );
      await refresh();
      if (result.redirectUrl) {
        window.location.assign(result.redirectUrl);
        return;
      }
      router.push(`/checkout/${result.groupId}`);
    } catch (error) {
      if (error instanceof ApiFailure) {
        setIssues(error.issues);
        toast.push(error.message, 'error');
      } else {
        toast.push('Could not reach Bemz — your basket is safe, try again', 'error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div className="container-page space-y-4 py-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Skeleton className="h-[420px]" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (phase === 'signed_out') {
    return (
      <div className="container-page py-12">
        <div className="card mx-auto max-w-md space-y-3 p-6 text-center">
          <Lock className="mx-auto size-6 text-bemz-600" />
          <h1 className="text-lg font-semibold text-ink-900">Sign in to place the order</h1>
          <p className="text-sm text-ink-600">
            An order needs a phone number a rider can call when the landmark is hard to find. Your basket is kept on
            this device and moves over when you sign in.
          </p>
          <div className="space-y-2">
            <LinkButton href="/login?callbackUrl=%2Fcheckout" block>
              Sign in or get a code
            </LinkButton>
            <LinkButton href="/cart" variant="outline" block>
              Back to basket
            </LinkButton>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'empty' || !sheet) {
    return (
      <div className="container-page py-12">
        <div className="card mx-auto max-w-md space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold text-ink-900">Nothing selected to order</h1>
          <p className="text-sm text-ink-600">
            Tick the items you want in the basket, then come back. Sold-out lines are ticked off automatically.
          </p>
          <LinkButton href="/cart" block>
            Review basket
          </LinkButton>
        </div>
      </div>
    );
  }

  if (phase === 'failed') {
    return (
      <div className="container-page py-12">
        <div className="card mx-auto max-w-md space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold text-ink-900">Checkout is not loading</h1>
          <p className="text-sm text-ink-600">Bemz may be updating. Wait a minute and reload — your basket is safe.</p>
          <Button onClick={() => router.refresh()}>Try again</Button>
        </div>
      </div>
    );
  }

  const selectedLines = sheet.cart.lines.filter((line) => line.selected);
  const needsPhone = needsPhoneFor(provider);

  return (
    <div className="container-page space-y-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-950">Checkout</h1>
          <p className="mt-1 text-sm text-ink-600">
            {sheet.cart.selectedCount} {sheet.cart.selectedCount === 1 ? 'item' : 'items'} · one order per shop, one
            payment for the whole basket
          </p>
        </div>
        <Link href="/cart" className="text-sm font-medium text-bemz-700 hover:underline">
          Edit basket
        </Link>
      </header>

      {sheet.blockers.length > 0 && (
        <div role="alert" className="card flex items-start gap-2 border-clay-200 bg-clay-50 p-4 text-sm text-clay-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <ul className="space-y-1">
            {sheet.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="space-y-5">
          <section className="card space-y-3 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-ink-900">1. Where should it go?</h2>
              <Link
                href="/account/addresses"
                className="inline-flex items-center gap-1 text-xs font-medium text-bemz-700 hover:underline"
              >
                <Plus className="size-3.5" aria-hidden />
                Add address
              </Link>
            </div>

            {sheet.addresses.length === 0 ? (
              <p className="text-sm text-ink-600">
                No saved address yet.{' '}
                <Link href="/account/addresses" className="font-medium text-bemz-700 hover:underline">
                  Add your district
                </Link>{' '}
                — delivery is priced by district, so this is what sets the fee.
              </p>
            ) : (
              <ul className="space-y-2">
                {sheet.addresses.map((address) => (
                  <li key={address.id}>
                    <label
                      className={`flex cursor-pointer gap-3 rounded-card border p-3 transition-colors ${
                        addressId === address.id ? 'border-bemz-500 bg-bemz-50/60' : 'border-ink-200 hover:border-ink-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="address"
                        checked={addressId === address.id}
                        onChange={() => void chooseAddress(address)}
                        className="mt-1 size-4 text-bemz-600 focus:ring-bemz-500"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-ink-900">{address.recipientName}</span>
                          {address.label && <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-600">{address.label}</span>}
                          {address.isDefault && <span className="rounded bg-bemz-100 px-1.5 py-0.5 text-[11px] font-medium text-bemz-800">Default</span>}
                        </span>
                        <span className="mt-0.5 block text-sm text-ink-600">
                          <MapPin className="mr-1 inline size-3.5" aria-hidden />
                          {address.districtName}
                          {address.subcounty ? ` · ${address.subcounty}` : ''}
                          {address.village ? ` · ${address.village}` : ''}
                          {address.streetAddress ? ` · ${address.streetAddress}` : ''}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {address.recipientPhone}
                          {address.nearestLandmark ? ` · near ${address.nearestLandmark}` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {issues.addressId && (
              <p role="alert" className="text-sm text-clay-700">
                {issues.addressId}
              </p>
            )}
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="font-semibold text-ink-900">2. How will you pay?</h2>

            <ul className="grid gap-2 sm:grid-cols-2">
              {(rail?.providers ?? []).map((option) => {
                const codBlocked = option.provider === 'CASH_ON_DELIVERY' && quote !== null && !quote.cashOnDeliveryAvailable;
                const disabled = !option.available || codBlocked;
                return (
                  <li key={option.provider}>
                    <label
                      className={`flex h-full cursor-pointer gap-3 rounded-card border p-3 ${
                        provider === option.provider ? 'border-bemz-500 bg-bemz-50/60' : 'border-ink-200 hover:border-ink-300'
                      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                    >
                      <input
                        type="radio"
                        name="paymentProvider"
                        value={option.provider}
                        checked={provider === option.provider}
                        disabled={disabled}
                        onChange={() => setProvider(option.provider)}
                        className="mt-1 size-4 text-bemz-600 focus:ring-bemz-500"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-ink-900">
                          {option.label}
                          {option.suggested && (
                            <span className="ml-1.5 rounded bg-bemz-100 px-1.5 py-0.5 text-[11px] font-medium text-bemz-800">
                              Matches your number
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {!option.available
                            ? 'Not live in your market yet'
                            : codBlocked
                              ? 'Cash on delivery is not available for this district or basket'
                              : option.provider === 'CASH_ON_DELIVERY'
                                ? 'Pay the rider when the parcel arrives'
                                : option.provider === 'STRIPE_CARD'
                                  ? 'Card details are handled by the payment provider, never by Bemz'
                                  : 'You get a prompt on the number below — enter your PIN there'}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            {rail?.guidance && <p className="text-xs text-ink-500">{rail.guidance}</p>}

            {needsPhone && (
              <div className="pt-1">
                <PhoneInput
                  label="Mobile money number to be prompted"
                  value={payerPhone}
                  onChange={setPayerPhone}
                  region={region}
                  onRegionChange={setRegion}
                  error={issues.payerPhone}
                  autoComplete="tel"
                />
                <p className="mt-1 text-xs text-ink-500">
                  This can be a different phone from the one you ordered on — it is the handset that will be asked for
                  the PIN.
                </p>
              </div>
            )}

            <div>
              <label className="field-label" htmlFor="buyer-note">
                Note for the seller <span className="text-ink-400">(optional)</span>
              </label>
              <textarea
                id="buyer-note"
                rows={2}
                value={buyerNote}
                maxLength={500}
                onChange={(event) => setBuyerNote(event.target.value)}
                placeholder="Call when you reach the junction — the gate is blue."
                className="field-input resize-y"
              />
              {issues.buyerNote && (
                <p role="alert" className="mt-1 text-sm text-clay-700">
                  {issues.buyerNote}
                </p>
              )}
            </div>
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="font-semibold text-ink-900">What you are ordering</h2>
            <ul className="divide-y divide-ink-200">
              {selectedLines.map((line) => (
                <li key={line.itemId} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{line.productTitle}</p>
                    <p className="text-xs text-ink-500">
                      {line.variantName} · {line.quantity} × {money(line.unitPriceMinor, line.currency)} ·{' '}
                      {line.shopName}
                    </p>
                  </div>
                  <span className="tabular text-sm font-semibold text-ink-900">
                    {money(line.lineTotalMinor, line.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <section className="card space-y-3 p-4">
            <h2 className="font-semibold text-ink-900">Total to pay</h2>

            {quoting && <Skeleton className="h-24" />}

            {!quoting && !quote && (
              <p className="text-sm text-ink-600">
                {selectedAddress
                  ? 'This district is not on a Bemz delivery zone yet — pick another address or choose cash on delivery where available.'
                  : 'Choose a delivery address to price delivery.'}
              </p>
            )}

            {!quoting && quote && (
              <div className="space-y-3">
                <ul className="space-y-2">
                  {quote.baskets.map((basket) => (
                    <li key={basket.shopId} className="rounded-lg bg-ink-50 p-2.5 text-xs">
                      <p className="font-semibold text-ink-800">{basket.shopName}</p>
                      <p className="mt-0.5 flex justify-between gap-2 text-ink-600">
                        <span>Items</span>
                        <span className="tabular">{money(basket.subtotalMinor, basket.currency)}</span>
                      </p>
                      <p className="flex justify-between gap-2 text-ink-600">
                        <span>Delivery to {basket.zoneName}</span>
                        <span className="tabular">{money(basket.shippingFeeMinor, basket.currency)}</span>
                      </p>
                      {basket.discountMinor > 0 && (
                        <p className="flex justify-between gap-2 text-bemz-700">
                          <span>Shop discount</span>
                          <span className="tabular">−{money(basket.discountMinor, basket.currency)}</span>
                        </p>
                      )}
                      <p className="mt-1 flex items-center gap-1 text-ink-500">
                        <Truck className="size-3.5" aria-hidden />
                        {etaLabel(basket.estimatedDaysMin, basket.estimatedDaysMax)}
                      </p>
                    </li>
                  ))}
                </ul>

                <dl className="space-y-1.5 text-sm">
                  <SummaryRow label="Subtotal" value={money(quote.subtotalMinor, quote.currency)} />
                  {quote.discountMinor > 0 && (
                    <SummaryRow label={`Discount${quote.couponCode ? ` (${quote.couponCode})` : ''}`} value={`−${money(quote.discountMinor, quote.currency)}`} tone="bemz" />
                  )}
                  <SummaryRow label="Delivery" value={money(quote.shippingFeeMinor, quote.currency)} />
                  <SummaryRow label="To pay" value={money(quote.totalMinor, quote.currency)} strong />
                </dl>

                {quote.freeShippingSavedMinor > 0 && (
                  <p className="text-xs text-bemz-700">
                    Free delivery on this shop — you saved {money(quote.freeShippingSavedMinor, quote.currency)}.
                  </p>
                )}
                {quote.couponMessage && <p className="text-xs text-ink-500">{quote.couponMessage}</p>}
                <p className="text-xs text-ink-500">
                  Prices include VAT where it applies ({money(quote.vatIncludedMinor, quote.currency)} inside the
                  totals above).
                </p>
              </div>
            )}

            <Button
              block
              loading={submitting}
              disabled={!sheet.canCheckOut || !addressId || !provider || !quote || submitting}
              onClick={() => void placeOrder()}
            >
              <Lock className="size-4" />
              {quote ? `Place order · ${money(quote.totalMinor, quote.currency)}` : 'Place order'}
            </Button>

            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-ink-500">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-bemz-600" aria-hidden />
              Mobile-money prompts are only sent to the number you enter above. Card payments run on the provider’s
              own page — Bemz never stores the card.
            </p>
          </section>

          <section className="card space-y-2 p-4 text-xs text-ink-600">
            <p className="font-semibold text-ink-800">Market</p>
            <p>
              Paying in {REGIONS[regionForCurrency(currency)].currencyLabel} ({REGIONS[regionForCurrency(currency)].name}
              ). Orders from different shops are packed and delivered separately, and each seller is paid after you
              receive the parcel.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, strong = false, tone = 'ink' }: { label: string; value: string; strong?: boolean; tone?: 'ink' | 'bemz' }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd
        className={`tabular ${strong ? 'text-base font-bold text-ink-900' : tone === 'bemz' ? 'text-bemz-700' : 'text-ink-800'}`}
      >
        {value}
      </dd>
    </div>
  );
}
