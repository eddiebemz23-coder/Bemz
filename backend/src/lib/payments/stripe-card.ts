import 'server-only';
import Stripe from 'stripe';
import { env } from '../env';
import { prisma, type CurrencyCode } from '../prisma';
import { badRequest, serviceUnavailable } from '../http';
import { sandboxEnabled, simulatedCharge, simulatedRefund, simulatedStatus } from './sandbox';
import { toStripeAmount, type ChargeRequest, type ChargeResult, type PaymentAdapter, type RefundResult, type StatusResult, type WebhookContext, type WebhookOutcome } from './types';

/**
 * Card payments via Stripe.
 *
 * Ugandan and Kenyan buyers overwhelmingly pay by mobile money, but sellers exporting
 * digitally and diaspora gift-buyers pay by card, so this exists for that tail. Note the
 * unit trap: Stripe treats UGX and KES as zero-decimal currencies, so a shilling amount is
 * sent as whole shillings while USD is sent as cents.
 */

let client: Stripe | null = null;

function stripe(): Stripe {
  const config = env();
  if (!config.STRIPE_SECRET_KEY) throw serviceUnavailable('Card payments are not configured on this server');
  if (!client) client = new Stripe(config.STRIPE_SECRET_KEY, { typescript: true, maxNetworkRetries: 2 });
  return client;
}

/** Our minor-unit convention (always /100) back from Stripe's per-currency convention. */
function fromStripeAmount(stripeAmount: number, currency: CurrencyCode): number {
  return currency === 'USD' ? stripeAmount : stripeAmount * 100;
}

function intentStatus(intent: Stripe.PaymentIntent): StatusResult['status'] {
  switch (intent.status) {
    case 'succeeded':
      return 'SUCCEEDED';
    case 'processing':
      return 'PROCESSING';
    case 'canceled':
      return 'EXPIRED';
    case 'requires_payment_method':
      return 'FAILED';
    default:
      return 'PROCESSING';
  }
}

class StripeAdapter implements PaymentAdapter {
  readonly provider = 'STRIPE_CARD' as const;

  isConfigured(): boolean {
    return Boolean(env().STRIPE_SECRET_KEY);
  }

  async initiate(request: ChargeRequest): Promise<ChargeResult> {
    if (sandboxEnabled(this.isConfigured())) return simulatedCharge(request.externalId, request.amountMinor, request.currency);

    const intent = await stripe().paymentIntents.create(
      {
        amount: toStripeAmount(request.amountMinor, request.currency),
        currency: request.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        description: request.description,
        receipt_email: request.payerEmail ?? undefined,
        metadata: { externalId: request.externalId, orderNumber: request.orderNumber },
      },
      // Stripe's own idempotency key: a retried checkout returns the same intent instead
      // of charging the card twice.
      { idempotencyKey: request.externalId },
    );

    return {
      status: intent.status === 'succeeded' ? 'SUCCEEDED' : 'PROCESSING',
      providerReference: intent.id,
      clientToken: intent.client_secret,
      redirectUrl: null,
      buyerInstruction: intent.status === 'requires_confirmation' ? 'Confirm the card payment in the popup.' : 'Enter your card details to complete the payment.',
      expiresAt: new Date(Date.now() + 30 * 60_000),
      failureReason: null,
      raw: { id: intent.id, status: intent.status },
    };
  }

  async status(externalId: string): Promise<StatusResult> {
    if (sandboxEnabled(this.isConfigured())) return simulatedStatus(externalId);
    const payment = await prisma.payment.findUnique({ where: { externalId }, select: { providerReference: true, currency: true } });
    if (!payment?.providerReference) throw badRequest('That payment has no Stripe intent yet');

    const intent = await stripe().paymentIntents.retrieve(payment.providerReference);
    const status = intentStatus(intent);
    return {
      status,
      providerReference: intent.id,
      providerFeeMinor: null,
      failureReason: status === 'FAILED' ? intent.last_payment_error?.message ?? 'The card was declined' : null,
      raw: { id: intent.id, status: intent.status, amount: intent.amount },
    };
  }

  async refund(params: { externalId: string; amountMinor: number; currency: CurrencyCode; reason: string }): Promise<RefundResult> {
    if (sandboxEnabled(this.isConfigured())) return simulatedRefund(params.externalId);
    const payment = await prisma.payment.findUnique({ where: { externalId: params.externalId }, select: { providerReference: true } });
    if (!payment?.providerReference) throw badRequest('That payment has no Stripe intent yet');

    try {
      const created = await stripe().refunds.create(
        {
          payment_intent: payment.providerReference,
          amount: toStripeAmount(params.amountMinor, params.currency),
          reason: 'requested_by_customer',
          metadata: { note: params.reason.slice(0, 100) },
        },
        { idempotencyKey: `${params.externalId}-refund` },
      );
      return {
        status: created.status === 'succeeded' ? 'SUCCEEDED' : created.status === 'failed' ? 'FAILED' : 'PENDING',
        providerReference: created.id,
        failureReason: created.status === 'failed' ? 'Stripe rejected the refund' : null,
        raw: { id: created.id, status: created.status },
      };
    } catch (error) {
      if (error instanceof Stripe.errors.StripeError) {
        return { status: 'FAILED', providerReference: null, failureReason: error.message, raw: { code: error.code } };
      }
      throw serviceUnavailable('Stripe is unreachable right now', { cause: String(error) });
    }
  }

  async verifyWebhook(context: WebhookContext): Promise<WebhookOutcome> {
    const config = env();
    const signature = context.headers.get('stripe-signature') ?? '';
    if (!config.STRIPE_WEBHOOK_SECRET) {
      return { signatureValid: false, event: { kind: 'ignored', reason: 'STRIPE_WEBHOOK_SECRET is not configured', providerEventId: null, raw: safeParse(context.rawBody) } };
    }

    let event: Stripe.Event;
    try {
      event = stripe().webhooks.constructEvent(context.rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      return { signatureValid: false, event: { kind: 'ignored', reason: `Stripe signature rejected: ${String(error)}`, providerEventId: null, raw: safeParse(context.rawBody) } };
    }

    const object = event.data.object as unknown as Record<string, unknown>;
    const metadata = (object.metadata ?? {}) as Record<string, string>;
    const externalId = metadata.externalId ?? null;
    const currency = (typeof object.currency === 'string' ? object.currency.toUpperCase() : 'USD') as CurrencyCode;
    const amount = typeof object.amount === 'number' ? fromStripeAmount(object.amount, currency) : null;

    if (event.type === 'payment_intent.succeeded' || event.type === 'charge.succeeded') {
      return { signatureValid: true, event: { kind: 'payment_succeeded', externalId, providerReference: typeof object.id === 'string' ? object.id : null, amountMinor: amount, providerEventId: event.id, raw: { type: event.type, id: object.id } } };
    }
    if (event.type === 'payment_intent.payment_failed' || event.type === 'charge.failed') {
      const lastError = (object.last_payment_error ?? {}) as { message?: string };
      return { signatureValid: true, event: { kind: 'payment_failed', externalId, providerReference: typeof object.id === 'string' ? object.id : null, reason: lastError.message ?? 'The card was declined', providerEventId: event.id, raw: { type: event.type, id: object.id } } };
    }
    if (event.type === 'charge.refunded') {
      return { signatureValid: true, event: { kind: 'refund_succeeded', externalId, providerReference: typeof object.id === 'string' ? object.id : null, providerEventId: event.id, raw: { type: event.type } } };
    }
    return { signatureValid: true, event: { kind: 'ignored', reason: `Unhandled Stripe event ${event.type}`, providerEventId: event.id, raw: { type: event.type } } };
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { unparseableBody: true };
  }
}

export const stripeCard = new StripeAdapter();
