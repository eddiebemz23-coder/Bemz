import 'server-only';
import type { CurrencyCode, PaymentProvider } from '../prisma';
import { fromMinor } from '../money';

/**
 * One shape for MTN MoMo, Airtel Money, Stripe and cash-on-delivery.
 *
 * The differences between these rails are brutal (MTN is a two-phase `requesttopay` +
 * `getstatus`, Airtel Uganda is a redirect-style cashier, Airtel Kenya is a direct debit,
 * Stripe is a PaymentIntent) — so each adapter converts its own vocabulary into the four
 * verbs below and nothing above this layer knows which rail was used.
 */

export type ChargeRequest = {
  /** Our unique reference sent to the provider; the provider echoes it on every callback. */
  externalId: string;
  amountMinor: number;
  currency: CurrencyCode;
  /** MSISDN the PIN prompt is pushed to — required for MoMo/Airtel, ignored by Stripe. */
  payerPhone?: string | null;
  payerEmail?: string | null;
  payerName?: string | null;
  orderNumber: string;
  description: string;
  /** Where a browser returns after card 3-D Secure. */
  returnUrl: string;
  /** Our webhook endpoint, handed to providers that support push callbacks. */
  callbackUrl: string;
};

export type ChargeResult = {
  status: 'PENDING_CUSTOMER' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  providerReference: string | null;
  /** MTN `clientCheckoutId` / Stripe PaymentIntent client secret. */
  clientToken: string | null;
  redirectUrl: string | null;
  /** What the buyer must do next, shown verbatim on the payment screen. */
  buyerInstruction: string;
  expiresAt: Date | null;
  failureReason: string | null;
  raw: unknown;
};

export type StatusResult = {
  status: 'PENDING_CUSTOMER' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';
  providerReference: string | null;
  /** Some operators bill a fee on collection; recorded but never added to the buyer total. */
  providerFeeMinor: number | null;
  failureReason: string | null;
  raw: unknown;
};

export type RefundResult = {
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  providerReference: string | null;
  failureReason: string | null;
  raw: unknown;
};

export type WebhookContext = {
  rawBody: string;
  headers: Headers;
  /** Provider endpoint that received this call, needed because Airtel UG and KE differ. */
  variant?: 'UG' | 'KE';
};

export type NormalisedEvent =
  | { kind: 'payment_succeeded'; externalId: string | null; providerReference: string | null; amountMinor: number | null; providerEventId: string | null; raw: unknown }
  | { kind: 'payment_failed'; externalId: string | null; providerReference: string | null; reason: string | null; providerEventId: string | null; raw: unknown }
  | { kind: 'refund_succeeded'; externalId: string | null; providerReference: string | null; providerEventId: string | null; raw: unknown }
  | { kind: 'ignored'; reason: string; providerEventId: string | null; raw: unknown };

export type WebhookOutcome = {
  /** False when the provider did not sign the call, or the signature did not match. */
  signatureValid: boolean;
  event: NormalisedEvent;
};

export interface PaymentAdapter {
  readonly provider: PaymentProvider;
  /** True when the environment has real credentials and calls will hit the operator. */
  isConfigured(): boolean;
  initiate(request: ChargeRequest): Promise<ChargeResult>;
  status(externalId: string): Promise<StatusResult>;
  refund(params: { externalId: string; amountMinor: number; currency: CurrencyCode; reason: string }): Promise<RefundResult>;
  verifyWebhook(context: WebhookContext): Promise<WebhookOutcome>;
}

/**
 * Mobile-money and Stripe disagree on "units".
 *
 * We store minor units (1/100) for every currency, but MTN/Airtel take a decimal major-unit
 * amount as a string, and Stripe treats UGX and KES as zero-decimal currencies — it wants
 * whole shillings, not hundredths.
 */
export const toMajorAmount = (amountMinor: number, currency: CurrencyCode): string =>
  currency === 'UGX' ? String(fromMinor(amountMinor, currency)) : fromMinor(amountMinor, currency).toFixed(2);

export const toStripeAmount = (amountMinor: number, currency: CurrencyCode): number =>
  currency === 'USD' ? amountMinor : Math.round(fromMinor(amountMinor, currency));

/** E.164 "+256771234567" -> operator-local "0771234567" (MTN/Airtel UG refuse a +). */
export const toLocalMsisdn = (e164: string, countryPrefix: string): string =>
  e164.startsWith(countryPrefix) ? `0${e164.slice(countryPrefix.length)}` : e164;

export const fromLocalMsisdn = (local: string, countryPrefix: string): string =>
  local.startsWith('0') ? `${countryPrefix}${local.slice(1)}` : local;
