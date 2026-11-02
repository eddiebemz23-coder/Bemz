import 'server-only';
import { createHmac, randomUUID } from 'node:crypto';
import { env } from '../env';
import { prisma, type CurrencyCode } from '../prisma';
import { badRequest, serviceUnavailable } from '../http';
import { toMinor } from '../money';
import { TokenCache, firstString, getJson, pick, readNumber, readString, requestRaw, type JsonRecord } from './provider-http';
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
 * Airtel Money, two different products behind one brand.
 *
 * Uganda runs the m2o "cashier" (the buyer is pushed a PIN prompt and a browser redirect is
 * returned). Kenya runs the classic Merchant API `collectMoneyInitiate` direct debit. The
 * request bodies, paths and status shapes differ, so the adapter is constructed with a
 * variant and `PAYMENT_METHOD` (initialiation) stays identical for both.
 *
 * Both use the same auth scheme: OAuth client credentials for the token, then three custom
 * headers on every call — `X-KKI-SESSION-ID`, `X-KKI-TIMESTAMP` and an
 * `X-KKI-SIGNATURE` HMAC of `body + timestamp` keyed with the client secret.
 */

export type AirtelVariant = 'UG' | 'KE';

const airtelConfig = (variant: AirtelVariant) => {
  const config = env();
  return variant === 'UG'
    ? {
        baseUrl: config.AIRTEL_BASE_URL_UG,
        clientId: config.AIRTEL_CLIENT_ID_UG ?? '',
        clientSecret: config.AIRTEL_CLIENT_SECRET_UG ?? '',
        merchantCode: config.AIRTEL_MERCHANT_CODE_UG ?? '',
      }
    : {
        baseUrl: config.AIRTEL_BASE_URL_KE,
        clientId: config.AIRTEL_CLIENT_ID_KE ?? '',
        clientSecret: config.AIRTEL_CLIENT_SECRET_KE ?? '',
        merchantCode: config.AIRTEL_MERCHANT_CODE_KE ?? '',
      };
};

function signedHeaders(body: string, clientSecret: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = createHmac('sha1', clientSecret).update(`${body}${timestamp}`).digest('base64');
  return {
    'X-KKI-SESSION-ID': randomUUID(),
    'X-KKI-TIMESTAMP': timestamp,
    'X-KKI-SIGNATURE': signature,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

const tokenCaches = new Map<AirtelVariant, TokenCache>();

function tokenCacheFor(variant: AirtelVariant): TokenCache {
  const cached = tokenCaches.get(variant);
  if (cached) return cached;
  const created = new TokenCache(async () => {
    const { baseUrl, clientId, clientSecret } = airtelConfig(variant);
    const url = variant === 'UG' ? `${baseUrl}/token` : `${baseUrl}/accessToken`;
    const response = await requestRaw(url, {
      method: variant === 'UG' ? 'GET' : 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        ...(variant === 'KE' ? { realm: 'airtelmerchant' } : {}),
        Accept: 'application/json',
      },
    });
    if (!response.ok) throw serviceUnavailable(`Airtel ${variant} token call failed (${response.status})`, response.body);
    const token = firstString(response.body, ['access_token', 'Data.AccessToken', 'Data.access_token', 'AccessToken']);
    if (!token) throw serviceUnavailable(`Airtel ${variant} returned no access token`, response.body);
    return { token, expiresInSeconds: readNumber(pick(response.body, 'expires_in')) ?? 1800 };
  });
  tokenCaches.set(variant, created);
  return created;
}

/** Airtel answers 200 even when it rejected the instruction — `responseCode` is the truth. */
function airtelFailed(body: JsonRecord): string | null {
  const code = firstString(body, ['ResponseCode', 'responseCode', 'Data.ResponseCode']);
  if (!code) return null;
  if (code === 'SUCCESS' || code === '00' || code === '000') return null;
  return firstString(body, ['ResponseMessage', 'responseMessage', 'Data.ResponseMessage']) ?? `Airtel returned ${code}`;
}

function mapAirtelStatus(raw: unknown): StatusResult['status'] {
  const value = (readString(raw) ?? '').toUpperCase();
  if (value.includes('SUCCESS')) return 'SUCCEEDED';
  if (value.includes('FAIL') || value.includes('CANCEL')) return 'FAILED';
  if (value.includes('EXPIR')) return 'EXPIRED';
  return 'PROCESSING';
}

export class AirtelMoneyAdapter implements PaymentAdapter {
  readonly provider = 'AIRTEL_MONEY' as const;

  constructor(private readonly variant: AirtelVariant) {}

  isConfigured(): boolean {
    const { clientId, clientSecret, merchantCode } = airtelConfig(this.variant);
    return Boolean(clientId && clientSecret && merchantCode);
  }

  private async call(path: string, method: 'GET' | 'POST', body: unknown): Promise<JsonRecord> {
    const { clientId, clientSecret } = airtelConfig(this.variant);
    const serialised = method === 'POST' ? JSON.stringify(body ?? {}) : '';
    const token = await tokenCacheFor(this.variant).get();
    const response = await requestRaw(`${airtelConfig(this.variant).baseUrl}${path}`, {
      method,
      ...(method === 'POST' ? { body: serialised } : {}),
      headers: {
        Authorization: `Bearer ${token}`,
        userId: clientId,
        ...signedHeaders(serialised, clientSecret),
      },
    });
    if (!response.ok) {
      throw serviceUnavailable(`Airtel Money ${this.variant} returned ${response.status}`, response.body);
    }
    const failure = airtelFailed(response.body);
    if (failure) throw serviceUnavailable(`Airtel Money rejected the request: ${failure}`, response.body);
    return response.body;
  }

  async initiate(request: ChargeRequest): Promise<ChargeResult> {
    const { merchantCode } = airtelConfig(this.variant);
    if (sandboxEnabled(this.isConfigured())) return simulatedCharge(request.externalId, request.amountMinor, request.currency);
    requireCredentials(this.isConfigured(), 'Airtel Money');
    if (!request.payerPhone) throw badRequest('Enter the Airtel Money number to be prompted for the PIN');

    const amount = toMajorAmount(request.amountMinor, request.currency);
    const body =
      this.variant === 'UG'
        ? {
            MerchantCode: merchantCode,
            Amount: amount,
            Currency: request.currency,
            Reference: request.externalId,
            PaymentItems: [{ Description: request.description.slice(0, 80), Amount: amount, Quantity: '1' }],
            PrimaryIdentifier: 'PAY_IN',
            BuyerMSISDN: { CountryCode: '+256', MSISDN: request.payerPhone.replace('+256', '0') },
            BuyerNotificationURL: `${request.callbackUrl}/airtel-ug`,
            BuyerRedirectURL: request.returnUrl,
          }
        : {
            Command: 'CustomerPaymentInitiation',
            Amount: amount,
            Currency: request.currency,
            Reference: request.externalId,
            Reason: request.orderNumber,
            TriangleID: request.externalId,
            MerchantCode: merchantCode,
            MSISDN: request.payerPhone.replace('+254', '0'),
            NotifyURL: `${request.callbackUrl}/airtel-ke`,
            ReturnURL: request.returnUrl,
        };

    const path = this.variant === 'UG' ? '/cashier' : '/collectMoneyInitiate';
    const response = await this.call(path, 'POST', body);
    return {
      status: 'PENDING_CUSTOMER',
      providerReference: firstString(response, ['Data.InvoiceId', 'Data.InvoiceID', 'InvoiceID']),
      clientToken: firstString(response, ['Data.BillReferenceNumber', 'Data.InvoiceId']),
      redirectUrl: firstString(response, ['Data.RedirectUrl', 'Data.ReturnUrl']),
      buyerInstruction: 'Enter your Airtel Money PIN on the prompt sent to your phone.',
      expiresAt: new Date(Date.now() + 10 * 60_000),
      failureReason: null,
      raw: response,
    };
  }

  async status(externalId: string): Promise<StatusResult> {
    if (sandboxEnabled(this.isConfigured())) return simulatedStatus(externalId);
    const payment = await prisma.payment.findUnique({
      where: { externalId },
      select: { providerReference: true, currency: true },
    });
    if (!payment?.providerReference) throw badRequest('That payment has no Airtel invoice yet');

    const path =
      this.variant === 'UG'
        ? `/cashier/${payment.providerReference}/status`
        : `/paymentStatus/${payment.providerReference}`;
    const body = await this.call(path, 'GET', undefined);
    const status = mapAirtelStatus(firstString(body, ['Data.Status', 'Status', 'Data.State']));
    const amountMajor = readNumber(firstString(body, ['Data.Amount', 'Amount']));
    const feeMajor = readNumber(firstString(body, ['Data.Commission', 'Commission']));

    return {
      status,
      providerReference: firstString(body, ['Data.FinancialTransactionID', 'FinancialTransactionID', 'Data.InvoiceId']),
      providerFeeMinor: feeMajor == null ? null : toMinor(feeMajor, payment.currency),
      failureReason: status === 'FAILED' ? firstString(body, ['Data.Reason', 'Reason']) ?? 'Airtel payment failed' : null,
      raw: body,
    };
  }

  /**
   * Airtel has no refund endpoint on either rail. Money goes back the way it came — the
   * seller's MoMo payout account — so a card-less refund is recorded as pending and settled
   * by the operations team.
   */
  async refund(params: { externalId: string; amountMinor: number; currency: CurrencyCode; reason: string }): Promise<RefundResult> {
    return {
      status: 'PENDING',
      providerReference: null,
      failureReason: null,
      raw: { manualSettlementRequired: true, externalId: params.externalId, amountMinor: params.amountMinor, reason: params.reason },
    };
  }

  async verifyWebhook(context: WebhookContext): Promise<WebhookOutcome> {
    const payload = JSON.parse(context.rawBody || '{}') as JsonRecord;
    const invoiceId = firstString(payload, ['Data.InvoiceId', 'Data.InvoiceID', 'InvoiceID', 'Data.Reference', 'Reference']);
    const providerEventId = firstString(payload, ['Data.FinancialTransactionID', 'FinancialTransactionID']) ?? invoiceId;

    // Airtel sends no signature; the invoice must be one we asked for.
    const known = invoiceId ? await prisma.payment.findFirst({ where: { providerReference: invoiceId }, select: { id: true, externalId: true, currency: true } }) : null;
    if (!known) {
      return { signatureValid: false, event: { kind: 'ignored', reason: 'Unknown Airtel invoice reference', providerEventId, raw: payload } };
    }

    const status = mapAirtelStatus(firstString(payload, ['Data.Status', 'Status', 'Data.State']));
    const amountMajor = readNumber(firstString(payload, ['Data.Amount', 'Amount']));

    if (status === 'SUCCEEDED') {
      return {
        signatureValid: false,
        event: {
          kind: 'payment_succeeded',
          externalId: known.externalId,
          providerReference: firstString(payload, ['Data.FinancialTransactionID', 'FinancialTransactionID']) ?? invoiceId,
          amountMinor: amountMajor == null ? null : toMinor(amountMajor, known.currency),
          providerEventId,
          raw: payload,
        },
      };
    }
    if (status === 'FAILED' || status === 'EXPIRED') {
      return {
        signatureValid: false,
        event: {
          kind: 'payment_failed',
          externalId: known.externalId,
          providerReference: invoiceId,
          reason: firstString(payload, ['Data.Reason', 'Reason']) ?? 'Airtel payment failed',
          providerEventId,
          raw: payload,
        },
      };
    }
    return { signatureValid: false, event: { kind: 'ignored', reason: `Airtel reported ${status}`, providerEventId, raw: payload } };
  }
}

export const airtelUganda = new AirtelMoneyAdapter('UG');
export const airtelKenya = new AirtelMoneyAdapter('KE');
