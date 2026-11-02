import 'server-only';
import { env } from '../env';
import { prisma, type CurrencyCode } from '../prisma';
import type { ChargeRequest, ChargeResult, PaymentAdapter, RefundResult, StatusResult, WebhookContext, WebhookOutcome } from './types';

/**
 * Cash on delivery is not a payment rail — it is a promise to pay the rider.
 *
 * The payment row exists so the order has one money trail like every other order, but it
 * only settles when the rider confirms delivery (see the orders service). Nothing is
 * "initiated" with an operator, so there is no status to poll and no callback to verify.
 */

class CashOnDeliveryAdapter implements PaymentAdapter {
  readonly provider = 'CASH_ON_DELIVERY' as const;

  isConfigured(): boolean {
    return env().COD_ENABLED;
  }

  async initiate(request: ChargeRequest): Promise<ChargeResult> {
    return {
      status: 'PENDING_CUSTOMER',
      providerReference: null,
      clientToken: null,
      redirectUrl: null,
      buyerInstruction: `Keep ${(request.amountMinor / 100).toLocaleString()} ${request.currency} ready — the rider confirms the cash on arrival.`,
      expiresAt: null,
      failureReason: null,
      raw: { cashOnDelivery: true, orderNumber: request.orderNumber },
    };
  }

  async status(externalId: string): Promise<StatusResult> {
    const payment = await prisma.payment.findUnique({
      where: { externalId },
      select: { status: true, order: { select: { status: true } } },
    });
    if (payment?.status === 'SUCCEEDED') {
      return { status: 'SUCCEEDED', providerReference: null, providerFeeMinor: 0, failureReason: null, raw: { cashCollected: true } };
    }
    return {
      status: payment?.order?.status === 'CANCELLED' ? 'EXPIRED' : 'PENDING_CUSTOMER',
      providerReference: null,
      providerFeeMinor: 0,
      failureReason: null,
      raw: { cashOnDelivery: true, orderStatus: payment?.order?.status ?? null },
    };
  }

  async refund(params: { externalId: string; amountMinor: number; currency: CurrencyCode; reason: string }): Promise<RefundResult> {
    return {
      status: 'PENDING',
      providerReference: null,
      failureReason: null,
      raw: { manualSettlementRequired: true, note: `Cash order ${params.externalId}: arrange a mobile-money transfer to the buyer`, amountMinor: params.amountMinor, currency: params.currency, reason: params.reason },
    };
  }

  async verifyWebhook(_context: WebhookContext): Promise<WebhookOutcome> {
    return { signatureValid: false, event: { kind: 'ignored', reason: 'Cash on delivery has no provider callback', providerEventId: null, raw: {} } };
  }
}

export const cashOnDelivery = new CashOnDeliveryAdapter();
