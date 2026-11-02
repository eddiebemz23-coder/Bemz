import 'server-only';
import { prisma, type WebhookProvider } from '../prisma';
import { badRequest } from '../http';
import { airtelKenya, airtelUganda, type AirtelVariant } from './airtel-money';
import { mtnMomo } from './mtn-momo';
import { stripeCard } from './stripe-card';
import { markPaymentFailed, settlePaymentSuccess } from './index';
import type { NormalisedEvent, PaymentAdapter } from './types';

/**
 * Webhook ingestion, shared by every rail.
 *
 * Order of operations matters more than anything else here:
 *   1. The raw event is persisted first and deduped on `(provider, providerEventId)`, so a
 *      provider replaying the same delivery cannot apply it twice.
 *   2. A `succeeded` event only settles when the amount matches the payment we asked for.
 *      A callback claiming "100 UGX paid" for a 100,000 UGX order is a fraud attempt, not a
 *      receipt, and is recorded as a mismatch instead of confirming the order.
 *   3. The handler returns a 200 for events it cannot act on (unknown reference) so the
 *      operator stops retrying, and only fails when the signature itself is bad.
 */

export type WebhookAcceptance = {
  handled: boolean;
  duplicate: boolean;
  signatureValid: boolean;
  outcome: string;
};

function webhookAdapter(provider: WebhookProvider, airtelVariant?: AirtelVariant): PaymentAdapter {
  if (provider === 'MTN_MOMO') return mtnMomo;
  if (provider === 'STRIPE') return stripeCard;
  return airtelVariant === 'KE' ? airtelKenya : airtelUganda;
}

/**
 * Rails that sign their callbacks. Airtel signs nothing — its only proof of authenticity is
 * that the invoice number matches a payment we asked for — so a missing signature there is the
 * normal case, not an attack.
 */
const SIGNED_PROVIDERS: WebhookProvider[] = ['MTN_MOMO', 'STRIPE'];

export async function ingestWebhook(params: {
  provider: WebhookProvider;
  rawBody: string;
  headers: Headers;
  airtelVariant?: AirtelVariant;
}): Promise<WebhookAcceptance> {
  const adapter = webhookAdapter(params.provider, params.airtelVariant);
  const { signatureValid, event } = await adapter.verifyWebhook({ rawBody: params.rawBody, headers: params.headers });

  const existing = event.providerEventId
    ? await prisma.webhookEvent.findUnique({
        where: { provider_providerEventId: { provider: params.provider, providerEventId: event.providerEventId } },
      })
    : null;

  if (existing?.status === 'PROCESSED') {
    return { handled: true, duplicate: true, signatureValid, outcome: 'Already processed' };
  }

  const record =
    existing ??
    (await prisma.webhookEvent.create({
      data: {
        provider: params.provider,
        eventType: event.kind,
        providerEventId: event.providerEventId,
        payload: (event.raw ?? {}) as object,
        signatureValid,
        status: 'PROCESSING',
      },
    }));

  // An unsigned callback that claims to be from a signing rail is never applied: it is
  // stored for the audit trail and answered as rejected. Anyone who can read an order
  // number could otherwise POST "payment succeeded" and get a parcel moving.
  if (!signatureValid && SIGNED_PROVIDERS.includes(params.provider)) {
    if (!existing) {
      await prisma.webhookEvent.update({
        where: { id: record.id },
        data: { status: 'IGNORED', processedAt: new Date(), error: 'signature did not verify' },
      });
    }
    return { handled: false, duplicate: false, signatureValid: false, outcome: 'Rejected: signature did not verify' };
  }

  try {
    const outcome = await applyEvent(params.provider, event);
    await prisma.webhookEvent.update({
      where: { id: record.id },
      data: { status: outcome.handled ? 'PROCESSED' : 'IGNORED', processedAt: new Date(), error: outcome.reason ?? null, paymentId: outcome.paymentId ?? undefined },
    });
    return { handled: outcome.handled, duplicate: false, signatureValid, outcome: outcome.summary };
  } catch (error) {
    await prisma.webhookEvent.update({
      where: { id: record.id },
      data: { status: 'FAILED', attempts: { increment: 1 }, error: String(error).slice(0, 500) },
    });
    throw error;
  }
}

type ApplyOutcome = { handled: boolean; summary: string; reason?: string; paymentId?: string | null };

async function applyEvent(provider: WebhookProvider, event: NormalisedEvent): Promise<ApplyOutcome> {
  if (event.kind === 'ignored') {
    return { handled: false, summary: event.reason, reason: event.reason };
  }

  if (!event.externalId) {
    return { handled: false, summary: 'Event carried no reference we can act on', reason: 'missing externalId' };
  }

  const payment = await prisma.payment.findUnique({
    where: { externalId: event.externalId },
    select: { id: true, status: true, amountMinor: true, currency: true, provider: true, orderId: true, providerReference: true },
  });
  if (!payment) {
    return { handled: false, summary: 'Payment no longer exists', reason: `unknown payment ${event.externalId}` };
  }

  if (event.kind === 'payment_succeeded') {
    // Never trust a callback's amount blindly: if it reports less than we invoiced, the
    // buyer is trying to pay a fraction of the bill.
    if (event.amountMinor != null && event.amountMinor < Number(payment.amountMinor)) {
      await markPaymentFailed(
        payment.id,
        `Operator reported ${event.amountMinor} ${payment.currency} against a ${payment.amountMinor} ${payment.currency} invoice`,
        'AMOUNT_MISMATCH',
      );
      return { handled: true, summary: 'Rejected: amount mismatch', reason: 'amount_mismatch', paymentId: payment.id };
    }
    if (provider === 'AIRTEL_MONEY' && !payment.providerReference && event.providerReference) {
      await prisma.payment.update({ where: { id: payment.id }, data: { providerReference: event.providerReference } });
    }
    await settlePaymentSuccess(payment.id);
    return { handled: true, summary: 'Payment settled', paymentId: payment.id };
  }

  if (event.kind === 'payment_failed') {
    await markPaymentFailed(payment.id, event.reason ?? 'Payment failed', 'PROVIDER_REPORTED_FAILURE');
    return { handled: true, summary: 'Payment marked failed', reason: event.reason ?? undefined, paymentId: payment.id };
  }

  if (event.kind === 'refund_succeeded') {
    const refund = await prisma.refund.findFirst({
      where: { paymentId: payment.id, status: { in: ['PENDING', 'PROCESSING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!refund) return { handled: false, summary: 'No open refund for this payment', reason: 'no refund row', paymentId: payment.id };

    const paidPayment = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { amountMinor: true } });
    const refundedSoFar = await prisma.refund.aggregate({
      where: { paymentId: payment.id, status: 'SUCCEEDED' },
      _sum: { amountMinor: true },
    });
    const totalRefunded = Number(refundedSoFar._sum.amountMinor ?? 0n) + Number(refund.amountMinor);

    await prisma.$transaction([
      prisma.refund.update({ where: { id: refund.id }, data: { status: 'SUCCEEDED', processedAt: new Date(), providerReference: event.providerReference } }),
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: totalRefunded >= Number(paidPayment.amountMinor) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      }),
    ]);
    return { handled: true, summary: 'Refund confirmed', paymentId: payment.id };
  }

  throw badRequest(`Unsupported webhook kind ${(event as { kind: string }).kind}`);
}
