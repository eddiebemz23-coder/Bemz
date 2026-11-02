import 'server-only';
import { prisma, type CurrencyCode, type Payment, type PaymentProvider, type PaymentStatus } from '../prisma';
import { badRequest, forbidden, notFound, unprocessable } from '../http';
import type { AuthenticatedUser } from '../auth/guards';
import { maskPhone } from '../phone';
import { airtelKenya, airtelUganda } from './airtel-money';
import { cashOnDelivery } from './cash-on-delivery';
import { mtnMomo } from './mtn-momo';
import { stripeCard } from './stripe-card';
import { env } from '../env';
import { newPaymentExternalId } from '../ids';
import type { ChargeRequest, ChargeResult, PaymentAdapter, StatusResult } from './types';

/**
 * The single place that turns an order into money movement and money movement back into
 * order state.
 *
 * Two rules keep this safe with real African payment rails, where callbacks arrive late,
 * twice, or out of order:
 *   1. A payment row is written BEFORE the provider is called, keyed by a unique
 *      `externalId`. A crash mid-call therefore leaves something to reconcile.
 *   2. State only ever moves forward — `SUCCEEDED` is terminal and re-applying a webhook is
 *      a no-op, so a duplicate `getstatus` poll can never double-confirm an order.
 */

const ADAPTERS: Record<PaymentProvider, PaymentAdapter> = {
  MTN_MOMO: mtnMomo,
  AIRTEL_MONEY: airtelUganda,
  STRIPE_CARD: stripeCard,
  CASH_ON_DELIVERY: cashOnDelivery,
};

/** Airtel runs a different product per country, so currency (not the buyer) picks the rail. */
export function adapterFor(provider: PaymentProvider, currency: CurrencyCode = 'UGX'): PaymentAdapter {
  if (provider === 'AIRTEL_MONEY') return currency === 'KES' ? airtelKenya : airtelUganda;
  return ADAPTERS[provider];
}

export function providerAvailable(provider: PaymentProvider): boolean {
  if (provider === 'CASH_ON_DELIVERY') return env().COD_ENABLED;
  return adapterFor(provider).isConfigured() || env().NODE_ENV !== 'production';
}

export const listPaymentProviders = (currency: CurrencyCode) =>
  (Object.keys(ADAPTERS) as PaymentProvider[]).map((provider) => ({
    provider,
    available: providerAvailable(provider),
    needsPhone: provider === 'MTN_MOMO' || provider === 'AIRTEL_MONEY',
    label:
      provider === 'MTN_MOMO'
        ? 'MTN Mobile Money'
        : provider === 'AIRTEL_MONEY'
          ? 'Airtel Money'
          : provider === 'STRIPE_CARD'
            ? 'Debit / credit card'
            : 'Cash on delivery',
    currency,
  }));

/**
 * The buyer-facing shape of a payment.
 *
 * `rawRequest`/`rawResponse` hold what the operator said, including bearer-token-bearing
 * payloads on some rails, and `feeMinor` is what the operator charged US — none of that belongs
 * in a browser. The payer number is masked because the handset that pays is often not the
 * handset that ordered.
 */
export const paymentView = (payment: Payment) => ({
  id: payment.id,
  provider: payment.provider,
  status: payment.status,
  amountMinor: Number(payment.amountMinor),
  currency: payment.currency,
  externalId: payment.externalId,
  providerReference: payment.providerReference,
  payerPhone: payment.payerPhone ? maskPhone(payment.payerPhone) : null,
  requestedAt: payment.requestedAt,
  completedAt: payment.completedAt,
  expiresAt: payment.expiresAt,
  failureCode: payment.failureCode,
  failureReason: payment.failureReason,
  retryCount: payment.retryCount,
  createdAt: payment.createdAt,
});

/**
 * Loads a payment and proves the caller owns the order behind it.
 *
 * Every buyer-facing payment route goes through here. A payment id is a cuid, but "guessing it
 * is hard" is not an authorisation model — without this check, one buyer could poll, initiate
 * or retry another buyer's MoMo charge.
 */
export async function loadPaymentForBuyer(paymentId: string, user: AuthenticatedUser) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      orderId: true,
      status: true,
      provider: true,
      currency: true,
      order: { select: { id: true, orderNumber: true, buyerId: true, status: true, expiresAt: true } },
    },
  });
  if (!payment) throw notFound('That payment no longer exists');
  if (!payment.order) throw notFound('That payment is not attached to an order');
  if (payment.order.buyerId !== user.id && user.role !== 'ADMIN') throw forbidden('This payment is not yours');

  return payment;
}

/** Called by checkout: creates the payment row that the provider will be told about. */
export async function createPayment(params: {
  orderId: string;
  provider: PaymentProvider;
  amountMinor: number;
  currency: CurrencyCode;
  payerPhone?: string | null;
  payerName?: string | null;
  externalId?: string;
  purpose?: 'ORDER' | 'SUBSCRIPTION';
}): Promise<Payment> {
  return prisma.payment.create({
    data: {
      orderId: params.orderId,
      purpose: params.purpose ?? 'ORDER',
      provider: params.provider,
      status: 'INITIATED',
      amountMinor: BigInt(params.amountMinor),
      currency: params.currency,
      payerPhone: params.payerPhone ?? null,
      payerName: params.payerName ?? null,
      externalId: params.externalId ?? newPaymentExternalId(),
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    },
  });
}

function terminal(status: PaymentStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED' || status === 'REFUNDED';
}

function instructionFor(result: ChargeResult, provider: PaymentProvider): string {
  if (result.buyerInstruction) return result.buyerInstruction;
  if (provider === 'CASH_ON_DELIVERY') return 'Keep the exact amount ready — the rider gives change at your door.';
  return 'Complete the payment prompt on your phone.';
}

/**
 * Pushes the buyer's handset. Never throws away the order: if the operator is unreachable
 * the payment stays PENDING and the status endpoint can recover it.
 */
export async function initiatePayment(paymentId: string): Promise<{ payment: Payment; instruction: string; redirectUrl: string | null }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { id: true, groupId: true, orderNumber: true, currency: true, buyer: { select: { email: true } } } } },
  });
  if (!payment) throw notFound('That payment no longer exists');
  if (!payment.order) throw notFound('That payment has no order');
  if (terminal(payment.status)) {
    return { payment, instruction: 'This payment is already settled.', redirectUrl: null };
  }

  const adapter = adapterFor(payment.provider, payment.currency);
  const appUrl = env().NEXT_PUBLIC_APP_URL;
  const request: ChargeRequest = {
    externalId: payment.externalId,
    amountMinor: Number(payment.amountMinor),
    currency: payment.currency,
    payerPhone: payment.payerPhone,
    payerEmail: payment.order.buyer.email,
    payerName: payment.payerName,
    orderNumber: payment.order.orderNumber,
    description: `Bemz order ${payment.order.orderNumber}`,
    // A card payer comes back from Stripe to a real page: the group receipt is the surface that
    // already polls the payment status, and `/orders/{id}` covers a legacy order with no group.
    returnUrl: `${appUrl}/${payment.order.groupId ? `checkout/${payment.order.groupId}` : `orders/${payment.order.id}`}`,
    callbackUrl: `${env().MTN_MOMO_CALLBACK_BASE_URL}/payments`,
  };

  let result: ChargeResult;
  try {
    result = await adapter.initiate(request);
  } catch (error) {
    // Network unknown: keep PENDING so a later poll/webhook can settle it.
    const updated = await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PROCESSING', rawResponse: { initiateError: String(error) } },
    });
    return { payment: updated, instruction: 'We sent the payment request. Check your phone, then refresh this page.', redirectUrl: null };
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: result.status,
      providerReference: result.providerReference,
      clientCheckoutId: result.clientToken,
      expiresAt: result.expiresAt,
      failureCode: result.failureReason ? 'PROVIDER_REJECTED' : null,
      failureReason: result.failureReason,
      rawRequest: {
        externalId: request.externalId,
        amountMinor: request.amountMinor,
        currency: request.currency,
        payerPhone: request.payerPhone,
        orderNumber: request.orderNumber,
        description: request.description,
      },
      rawResponse: (result.raw ?? {}) as object,
      completedAt: result.status === 'SUCCEEDED' ? new Date() : null,
    },
  });

  if (result.status === 'SUCCEEDED') await settlePaymentSuccess(updated.id);

  return { payment: updated, instruction: instructionFor(result, payment.provider), redirectUrl: result.redirectUrl };
}

/** Order-level effects of a payment that actually landed. */
export async function settlePaymentSuccess(paymentId: string): Promise<void> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { order: { select: { id: true, groupId: true, status: true, amountPaidMinor: true, totalMinor: true } } },
  });
  if (!payment) throw notFound('That payment no longer exists');
  if (payment.status === 'SUCCEEDED') return;

  await prisma.payment.update({
    where: { id: payment.id },
    data: { status: 'SUCCEEDED', completedAt: payment.completedAt ?? new Date() },
  });

  if (!payment.order) return;

  // A mobile-money or card charge settles the whole basket, so every order in the group is
  // credited at once; a cash order is settled parcel by parcel.
  const scope = await prisma.order.findMany({
    where: payment.order.groupId ? { groupId: payment.order.groupId } : { id: payment.order.id },
    select: { id: true, status: true, totalMinor: true },
  });

  const coveredMinor = scope.reduce((sum, order) => sum + Number(order.totalMinor), 0);
  const collectedMinor = Number(payment.amountMinor);
  if (scope.length === 0) return;

  if (collectedMinor < coveredMinor) {
    // Under-payment (a partial MoMo transfer): credit it against the largest order and leave
    // everything awaiting the balance rather than shipping half an order.
    const largest = scope.reduce((best, candidate) => (Number(candidate.totalMinor) > Number(best.totalMinor) ? candidate : best), scope[0]!);
    await prisma.$transaction([
      prisma.order.update({ where: { id: largest.id }, data: { amountPaidMinor: BigInt(collectedMinor) } }),
      prisma.orderStatusEvent.create({
        data: { orderId: largest.id, from: largest.status, to: largest.status, note: `Partial payment of ${collectedMinor} ${payment.currency} recorded` },
      }),
    ]);
    return;
  }

  await prisma.$transaction([
    ...scope.map((order) =>
      prisma.order.update({
        where: { id: order.id },
        data: {
          amountPaidMinor: order.totalMinor,
          status: order.status === 'AWAITING_PAYMENT' ? 'AWAITING_CONFIRMATION' : order.status,
        },
      }),
    ),
    ...scope
      .filter((order) => order.status === 'AWAITING_PAYMENT')
      .map((order) =>
        prisma.orderStatusEvent.create({
          data: { orderId: order.id, from: 'AWAITING_PAYMENT', to: 'AWAITING_CONFIRMATION', note: `Payment ${payment.externalId} received` },
        }),
      ),
  ]);
}

export async function markPaymentFailed(paymentId: string, reason: string, code = 'PROVIDER_FAILED'): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, status: true, orderId: true } });
  if (!payment || terminal(payment.status)) return;

  await prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'FAILED', failureCode: code, failureReason: reason.slice(0, 300) },
  });

  // The order stays payable: the buyer can retry with another rail until it expires.
  if (payment.orderId) {
    await prisma.orderStatusEvent.create({
      data: { orderId: payment.orderId, from: 'AWAITING_PAYMENT', to: 'AWAITING_PAYMENT', note: `Payment failed: ${reason.slice(0, 200)}` },
    });
  }
}

export async function expirePayment(paymentId: string, reason = 'No PIN entered before the timeout'): Promise<void> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, select: { id: true, status: true } });
  if (!payment || terminal(payment.status)) return;
  await prisma.payment.update({ where: { id: paymentId }, data: { status: 'EXPIRED', failureCode: 'EXPIRED', failureReason: reason } });
}

/**
 * Recovery path for the buyer-facing "did my money go through?" button and for any payment
 * whose webhook never arrived.
 */
export async function refreshPaymentStatus(paymentId: string): Promise<Payment> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, externalId: true, provider: true, currency: true, status: true },
  });
  if (!payment) throw notFound('That payment no longer exists');
  if (terminal(payment.status)) return prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });

  const adapter = adapterFor(payment.provider, payment.currency);
  let result: StatusResult;
  try {
    result = await adapter.status(payment.externalId);
  } catch (error) {
    // A real operator that is unreachable must stay unresolved; only a sandbox with no
    // credentials at all is answered as paid, so local flows stay testable.
    if (adapter.isConfigured() || env().NODE_ENV === 'production') throw error;
    result = { status: 'SUCCEEDED', providerReference: `SIM-${payment.externalId}`, providerFeeMinor: 0, failureReason: null, raw: { simulated: true, error: String(error) } };
  }

  const status = result.status as PaymentStatus;
  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status,
      providerReference: result.providerReference ?? undefined,
      failureCode: status === 'FAILED' ? 'PROVIDER_FAILED' : undefined,
      failureReason: result.failureReason ?? undefined,
      completedAt: status === 'SUCCEEDED' ? new Date() : undefined,
      rawResponse: (result.raw ?? {}) as object,
    },
  });

  if (status === 'SUCCEEDED') await settlePaymentSuccess(payment.id);
  if (status === 'FAILED') await markPaymentFailed(payment.id, result.failureReason ?? 'Payment failed');

  return updated;
}

/** Buyer retry after a failed prompt: a fresh external id, same order. */
export async function retryPayment(paymentId: string, params: { payerPhone?: string | null }): Promise<{ payment: Payment; instruction: string; redirectUrl: string | null }> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, status: true, provider: true, currency: true, amountMinor: true, orderId: true, retryCount: true, payerPhone: true, payerName: true },
  });
  if (!payment) throw notFound('That payment no longer exists');
  if (!['FAILED', 'EXPIRED', 'CANCELLED'].includes(payment.status)) {
    throw unprocessable('This payment is still live — check its status instead of retrying');
  }
  if (payment.retryCount >= 3) throw unprocessable('Too many failed attempts. Contact support with your order number.');

  const fresh = await createPayment({
    orderId: payment.orderId ?? '',
    provider: payment.provider,
    amountMinor: Number(payment.amountMinor),
    currency: payment.currency,
    payerPhone: params.payerPhone ?? payment.payerPhone,
    payerName: payment.payerName,
  });
  await prisma.payment.update({ where: { id: payment.id }, data: { retryCount: { increment: 1 }, status: 'CANCELLED', failureReason: 'Replaced by a retry' } });
  return initiatePayment(fresh.id);
}

export async function refundPayment(params: { orderId: string; amountMinor: number; reason: string; actorId?: string | null }): Promise<{ refundId: string; status: 'PENDING' | 'SUCCEEDED' | 'FAILED'; message: string }> {
  const order = await prisma.order.findUnique({
    where: { id: params.orderId },
    select: { id: true, totalMinor: true, refundedMinor: true, amountPaidMinor: true, currency: true, status: true },
  });
  if (!order) throw notFound('Order not found');

  const alreadyRefunded = Number(order.refundedMinor);
  const refundable = Number(order.amountPaidMinor) - alreadyRefunded;
  if (refundable <= 0) throw badRequest('This order has nothing left to refund');
  if (params.amountMinor > refundable) {
    throw badRequest(`At most ${(refundable / 100).toLocaleString()} ${order.currency} can be refunded on this order`);
  }

  const payment = await prisma.payment.findFirst({
    where: { orderId: order.id, status: 'SUCCEEDED' },
    orderBy: { completedAt: 'desc' },
  });
  if (!payment) throw badRequest('No successful payment on this order to refund');

  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      orderId: order.id,
      amountMinor: BigInt(params.amountMinor),
      currency: order.currency,
      status: 'PENDING',
      reason: params.reason,
      processedById: params.actorId ?? null,
    },
  });

  const adapter = adapterFor(payment.provider, payment.currency);
  const result = await adapter.refund({
    externalId: payment.externalId,
    amountMinor: params.amountMinor,
    currency: payment.currency,
    reason: params.reason,
  });

  await prisma.refund.update({
    where: { id: refund.id },
    data: {
      status: result.status,
      providerReference: result.providerReference,
      processedAt: result.status === 'SUCCEEDED' ? new Date() : null,
    },
  });

  if (result.status === 'SUCCEEDED') {
    const refundedMinor = alreadyRefunded + params.amountMinor;
    const fullyRefunded = refundedMinor >= Number(order.amountPaidMinor);
    await prisma.$transaction([
      prisma.payment.update({
        where: { id: payment.id },
        data: { status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { refundedMinor: BigInt(refundedMinor), status: fullyRefunded && order.status !== 'DELIVERED' ? 'REFUNDED' : order.status },
      }),
    ]);
  }

  return {
    refundId: refund.id,
    status: result.status,
    message:
      result.status === 'SUCCEEDED'
        ? 'Refund sent to the buyer’s wallet.'
        : result.status === 'PENDING'
          ? 'Refund queued — mobile money refunds settle within 24 hours.'
          : `Refund failed: ${result.failureReason ?? 'the provider rejected it'}`,
  };
}

/** Used by the seller-payout job so a payout and a collection never share a reference. */
export const paymentExternalIdForPayout = (payoutId: string) => `POUT-${payoutId.slice(-12)}`;
