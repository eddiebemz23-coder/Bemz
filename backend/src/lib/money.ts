/**
 * Money handling for UGX / KES / USD.
 *
 * The database stores every amount as an integer number of MINOR units (1/100 of the
 * major unit). Uganda shilling and Kenyan shilling are quoted in whole shillings in
 * everyday trade, but mobile-money APIs (MTN MoMo, Airtel Money) and Stripe all
 * transact in the smallest currency unit, so the same representation works end-to-end.
 */

/**
 * Declared here instead of imported from `@prisma/client` so the price formatter can run in
 * the browser bundle: pulling in the generated client would drag `fs` with it. Prisma's
 * `CurrencyCode` enum is the same union, so every server-side caller still typechecks.
 */
export type CurrencyCode = 'UGX' | 'KES' | 'USD';

export const MINOR_UNIT_EXPONENT: Record<CurrencyCode, number> = {
  UGX: 2,
  KES: 2,
  USD: 2,
};

/**
 * Locale used when rendering prices per currency.
 *
 * Hyphens, not underscores: `Intl.NumberFormat` throws `RangeError: Incorrect locale
 * information provided` for a tag like `en_UG`, and a thrown formatter takes down every page
 * that shows a price. (Open Graph metadata keeps the underscore spelling — that is a different
 * convention and is never handed to `Intl`.)
 */
const DISPLAY_LOCALE: Record<CurrencyCode, string> = {
  UGX: 'en-UG',
  KES: 'en-KE',
  USD: 'en-US',
};

export function toMinor(majorUnits: number, currency: CurrencyCode): number {
  const factor = 10 ** MINOR_UNIT_EXPONENT[currency];
  return Math.round(majorUnits * factor);
}

export function fromMinor(minorUnits: number, currency: CurrencyCode): number {
  return minorUnits / 10 ** MINOR_UNIT_EXPONENT[currency];
}

/**
 * UGX is quoted with no decimals in Uganda and KES with two in Kenya, so fraction
 * digits are derived per currency rather than trusting Intl's defaults.
 */
const MINOR_WITH_NO_DECIMALS: CurrencyCode[] = ['UGX'];

export function formatMoney(
  minorUnits: number | bigint,
  currency: CurrencyCode,
  options?: { showDecimals?: boolean; compact?: boolean },
): string {
  const value = Number(minorUnits);
  const showDecimals =
    options?.showDecimals ?? (options?.compact !== true && !MINOR_WITH_NO_DECIMALS.includes(currency));

  return new Intl.NumberFormat(DISPLAY_LOCALE[currency], {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: showDecimals ? 2 : 0,
    minimumFractionDigits: showDecimals ? 2 : 0,
    notation: options?.compact ? 'compact' : 'standard',
  }).format(fromMinor(value, currency));
}

/** VAT/tax in basis points -> tax amount in minor units, rounded to the nearest unit. */
export function taxFromBps(amountMinor: number, taxRateBps: number): number {
  return Math.round((amountMinor * taxRateBps) / 10_000);
}

/** Commission in basis points taken by the platform from a line total. */
export function commissionFromBps(amountMinor: number, commissionBps: number): number {
  return Math.round((amountMinor * commissionBps) / 10_000);
}

/**
 * Percentage discount in basis points (1250 = 12.5%), capped at the coupon's
 * maximum discount.
 */
export function percentageDiscountMinor(
  subtotalMinor: number,
  valueBps: number,
  maxDiscountMinor?: number | null,
): number {
  const raw = Math.round((subtotalMinor * valueBps) / 10_000);
  return maxDiscountMinor == null ? raw : Math.min(raw, maxDiscountMinor);
}

/**
 * Shipping for a basket: the highest zone fee among the shops being delivered from,
 * plus the per-kg surcharge for the total weight, waived above the zone threshold.
 */
export function shippingFeeMinor(params: {
  baseFeeMinor: number;
  perKgFeeMinor: number;
  freeOverMinor?: number | null;
  subtotalMinor: number;
  totalWeightGrams: number;
  includedWeightGrams?: number;
}): number {
  if (params.freeOverMinor != null && params.subtotalMinor >= params.freeOverMinor) return 0;

  const included = params.includedWeightGrams ?? 2_000; // first 2 kg is in the base fee
  const extraKg = Math.max(0, Math.ceil((params.totalWeightGrams - included) / 1_000));
  return params.baseFeeMinor + extraKg * params.perKgFeeMinor;
}

export const isSameCurrency = (a: CurrencyCode, b: CurrencyCode): boolean => a === b;
