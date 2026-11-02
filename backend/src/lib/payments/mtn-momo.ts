import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env';
import { prisma, type CurrencyCode, type PaymentProvider } from '../prisma';
import { badRequest } from '../http';
import { toMinor } from '../money';
import {
  TokenCache,
  basicAuth,
  firstString,
  getJson,
  pick,
  postJson,
  readNumber,
  readString,
  type JsonRecord,
} from './provider-http';
import { requireCredentials, sandboxEnabled, simulatedCharge, simulatedRefund, simulatedStatus } from './sandbox';
import {
  toMajorAmount,
  type ChargeRequest,
  type ChargeResult,
  type PaymentAdapter,
  type RefundResult,
  type StatusResult,
  type WebhookContext,
  type WebhookOutcome,
} from './types';

/**
 * MTN Mobile Money — Uganda "Merchant Money" collection API (momoapi.mtn.co.ug v1).
 *
 * The flow is two-phase: `POST /requesttopay` pushes a PIN prompt to the handset and
 * answers 202 with a `uuid` immediately — it is never a synchronous success. The real
 * result arrives on the webhook, and `GET /requesttopay/{uuid}/status` is the fallback if
 * the webhook is late. The number is sent as a local MSISDN (`077…`), never E.164.
 */

const tokenCache = new TokenCache(async () => {
  const config = env();
  if (!config.MTN_MOMO_API_USER || !config.MTN_MOMO_API_SECRET || !config.MTN_MOMO_SUBSCRIPTION_KEY) {
    throw badRequest('MTN MoMo API credentials are missing');
  }
  const body = await postJson(
    `${config.MTN_MOMO_BASE_URL}/token`,
    {},
    {
      authorization: basicAuth(config.MTN_MOMO_API_USER, config.MTN_MOMO_API_SECRET),
      'Ocp-Apim-Subscription-Key': config.MTN_MOMO_SUBSCRIPTION_KEY,
    },
  );
  const token = readString(body.access_token);
  if (!token) throw new Error('MTN token response had no access_token');
  return { token, expiresInSeconds: readNumber(body.expires_in) ?? 3600 };
});

async function momoHeaders(jsonPost = true): Promise<Record<string, string>> {
  const config = env();
  return {
    authorization: `Bearer ${await tokenCache.get()}`,
    'Ocp-Apim-Subscription-Key': config.MTN_MOMO_SUBSCRIPTION_KEY ?? '',
    ...(jsonPost ? { 'content-type': 'application/json', accept: 'application/json' } : {}),
  };
}

/** 401 means the bearer expired early; refresh once rather than failing the checkout. */
async function postWithRetry(url: string, body: unknown, headersFactory: () => Promise<Record<string, string>>) {
  const response = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: await headersFactory() });
  if (response.status === 401) {
    tokenCache.invalidate();
    return fetch(url, { method: 'POST', body: JSON.stringify(body), headers: await headersFactory() });
  }
  return response;
}

function parseBody(text: string): JsonRecord {
  return text.trim() ? (JSON.parse(text) as JsonRecord) : {};
}

function localMsisdn(e164: string): string {
  if (!e164) throw badRequest('A mobile money number is required');
  return e164.startsWith('+256') ? `0${e164.slice(4)}` : e164.replace(/^\+/, '');
}

function mapStatus(raw: unknown): StatusResult['status'] {
  const value = (readString(raw) ?? '').toUpperCase();
  if (value === 'SUCCESSFUL' || value === 'SUCCEEDED' || value === 'SUCCESS') return 'SUCCEEDED';
  if (value === 'FAILED') return 'FAILED';
  if (value === 'EXPIRED' || value === 'CANCELLED') return 'EXPIRED';
  return 'PROCESSING';
}

class MtnMomoAdapter implements PaymentAdapter {
  readonly provider: PaymentProvider = 'MTN_MOMO';

  isConfigured(): boolean {
    const config = env();
    return Boolean(config.MTN_MOMO_API_USER && config.MTN_MOMO_API_SECRET && config.MTN_MOMO_SUBSCRIPTION_KEY);
  }

  async initiate(request: ChargeRequest): Promise<ChargeResult> {
    const config = env();
    if (sandboxEnabled(this.isConfigured())) return simulatedCharge(request.externalId, request.amountMinor, request.currency);
    requireCredentials(this.isConfigured(), 'MTN Mobile Money');
    if (!request.payerPhone) throw badRequest('Enter the MTN number that will be prompted for the PIN');

    const body = {
      amount: toMajorAmount(request.amountMinor, request.currency),
      currency: request.currency,
      externalId: request.externalId,
      payerMessage: `Pay for Bemz order ${request.orderNumber}`,
      payeeNote: request.description.slice(0, 150),
      payer: { partyIdType: 'MSISDN', partyId: localMsisdn(request.payerPhone) },
      sponsor: { beneficiary: config.MTN_MOMO_COLLECTION_TARGET },
    };

    const response = await postWithRetry(`${config.MTN_MOMO_BASE_URL}/requesttopay`, body, () => momoHeaders());
    const parsed = parseBody(await response.text());
    if (!response.ok) {
      const reason = firstString(parsed, ['message', 'error_message', 'reason']) ?? `MTN rejected the payment (HTTP ${response.status})`;
      return {
        status: 'FAILED',
        providerReference: null,
        clientToken: null,
        redirectUrl: null,
        buyerInstruction: reason,
        expiresAt: null,
        failureReason: reason,
        raw: parsed,
      };
    }

    const uuid = readString(parsed.uuid) ?? readString(parsed.requestId);
    return {
      status: readString(parsed.status)?.toUpperCase() === 'SUCCESSFUL' ? 'SUCCEEDED' : 'PENDING_CUSTOMER',
      providerReference: uuid,
      // The buyer's handset is the checkout surface; there is nothing to click in a browser.
      clientToken: uuid,
      redirectUrl: null,
      buyerInstruction: 'Check your phone and enter your MTN MoMo PIN to release the payment.',
      expiresAt: new Date(Date.now() + 5 * 60_000),
      failureReason: null,
      raw: parsed,
    };
  }

  async status(externalId: string): Promise<StatusResult> {
    if (sandboxEnabled(this.isConfigured())) return simulatedStatus(externalId);
    const config = env();
    const payment = await prisma.payment.findUnique({ where: { externalId }, select: { providerReference: true, currency: true, amountMinor: true } });
    if (!payment?.providerReference) throw badRequest('That payment has no operator reference yet');

    const body = await getJson(`${config.MTN_MOMO_BASE_URL}/requesttopay/${payment.providerReference}/status`, await momoHeaders(false));
    const status = mapStatus(pick(body, 'status'));
    const feeMajor = readNumber(pick(body, 'fee'));

    return {
      status,
      providerReference: firstString(body, ['financialTransactionId', 'subRef']),
      // MoMo fees are the merchant's cost, recorded for reconciliation only.
      providerFeeMinor: feeMajor == null ? null : toMinor(feeMajor, payment.currency),
      failureReason: status === 'FAILED' ? firstString(body, ['reason', 'failure.reason']) ?? 'The customer did not complete the PIN prompt' : null,
      raw: body,
    };
  }

  async refund(params: { externalId: string; amountMinor: number; currency: CurrencyCode; reason: string }): Promise<RefundResult> {
    if (sandboxEnabled(this.isConfigured())) return simulatedRefund(params.externalId);
    const config = env();
    const payment = await prisma.payment.findUnique({ where: { externalId: params.externalId }, select: { providerReference: true } });
    if (!payment?.providerReference) throw badRequest('That payment was never submitted to MTN');

    const response = await postWithRetry(
      `${config.MTN_MOMO_BASE_URL}/refund/${payment.providerReference}`,
      {
        amount: toMajorAmount(params.amountMinor, params.currency),
        currency: params.currency,
        payerMessage: `Refund for ${params.externalId}`,
        payeeNote: params.reason.slice(0, 150),
      },
      () => momoHeaders(),
    );
    const parsed = parseBody(await response.text());
    if (!response.ok) {
      return { status: 'FAILED', providerReference: null, failureReason: firstString(parsed, ['message', 'reason']) ?? 'MTN refund rejected', raw: parsed };
    }
    return {
      status: readString(parsed.status)?.toUpperCase() === 'SUCCESSFUL' ? 'SUCCEEDED' : 'PENDING',
      providerReference: readString(parsed.uuid) ?? readString(parsed.financialTransactionId),
      failureReason: null,
      raw: parsed,
    };
  }

  /**
   * MTN posts `{externalId, status, financialTransactionId, reason, type}` and signs the
   * body only when a primary key is configured. A call is accepted when the `externalId`
   * matches a payment we created ourselves, so an attacker cannot mark an order paid
   * without a request that actually left this server; the amount is re-checked against the
   * order in the webhook handler.
   */
  async verifyWebhook(context: WebhookContext): Promise<WebhookOutcome> {
    const config = env();
    const payload = JSON.parse(context.rawBody || '{}') as JsonRecord;
    const externalId = firstString(payload, ['externalId', 'subRef']);
    const providerEventId = firstString(payload, ['subRef', 'id']) ?? externalId;
    const signatureValid = verifyMtnSignature(context.rawBody, context.headers, config.MTN_MOMO_PRIMARY_KEY ?? '');

    const known = externalId ? await prisma.payment.findUnique({ where: { externalId }, select: { id: true } }) : null;
    if (!known) {
      return { signatureValid, event: { kind: 'ignored', reason: 'Unknown externalId for MTN', providerEventId, raw: payload } };
    }

    const status = mapStatus(pick(payload, 'status'));
    const amountMajor = readNumber(pick(payload, 'amount'));
    const currency = (firstString(payload, ['currency']) as CurrencyCode | null) ?? 'UGX';

    if (status === 'SUCCEEDED') {
      return {
        signatureValid,
        event: {
          kind: 'payment_succeeded',
          externalId,
          providerReference: firstString(payload, ['financialTransactionId', 'subRef']),
          amountMinor: amountMajor == null ? null : toMinor(amountMajor, currency),
          providerEventId,
          raw: payload,
        },
      };
    }
    if (status === 'FAILED' || status === 'EXPIRED') {
      return {
        signatureValid,
        event: {
          kind: 'payment_failed',
          externalId,
          providerReference: firstString(payload, ['financialTransactionId']),
          reason: firstString(payload, ['reason', 'failure.reason']) ?? 'Payment not completed',
          providerEventId,
          raw: payload,
        },
      };
    }
    return { signatureValid, event: { kind: 'ignored', reason: `MTN reported ${status}`, providerEventId, raw: payload } };
  }
}

function verifyMtnSignature(rawBody: string, headers: Headers, secret: string): boolean {
  if (!secret) return false;
  const provided = headers.get('x-mtn-signature') ?? headers.get('x-signature');
  if (!provided) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const bufferA = Buffer.from(expected);
  const bufferB = Buffer.from(provided);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export const mtnMomo = new MtnMomoAdapter();
