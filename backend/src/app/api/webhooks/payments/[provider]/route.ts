import { z } from 'zod';
import { withRoute, jsonBody, unauthorized, badRequest, privateCache, type RouteContext } from '@/lib/http';
import { ingestWebhook } from '@/lib/payments/webhooks';
import type { WebhookProvider } from '@/lib/prisma';
import type { AirtelVariant } from '@/lib/payments/airtel-money';

const paramsSchema = z.object({ provider: z.enum(['mtn-momo', 'airtel-ug', 'airtel-ke', 'stripe']) });

const RAILS: Record<string, { provider: WebhookProvider; airtelVariant?: AirtelVariant; label: string }> = {
  'mtn-momo': { provider: 'MTN_MOMO', label: 'MTN MoMo' },
  'airtel-ug': { provider: 'AIRTEL_MONEY', airtelVariant: 'UG', label: 'Airtel Money Uganda' },
  'airtel-ke': { provider: 'AIRTEL_MONEY', airtelVariant: 'KE', label: 'Airtel Money Kenya' },
  stripe: { provider: 'STRIPE', label: 'Stripe' },
};

/** MoMo callbacks carry the full transaction object; anything bigger is not one of ours. */
const MAX_PAYLOAD_BYTES = 100_000;

/**
 * `POST /api/webhooks/payments/[provider]`
 *
 * The endpoint every rail reports to. Three things that are easy to get wrong and are the
 * whole reason this file exists:
 *
 * 1. The body is read as TEXT, not parsed. A signature is computed over the exact bytes the
 *    provider sent; re-serialising a parsed object changes key order and spacing, so every
 *    legitimate Stripe event would fail verification.
 * 2. Airtel runs separate products in Uganda and Kenya under one `AIRTEL_MONEY` provider, so
 *    the URL picks which credentials and which callback host to verify against.
 * 3. A 200 is returned for events we cannot act on. An operator that gets a 4xx retries the
 *    delivery for hours and eventually flags the endpoint as broken; an unknown reference is
 *    recorded and acknowledged, and reconciliation catches up later.
 *
 * A failed signature gets a 401 and the event is never applied — see `ingestWebhook`.
 */
export const POST = withRoute<{ provider: string }>(async (request: Request, context: RouteContext<{ provider: string }>) => {
  const { provider: slug } = paramsSchema.parse(context.params);
  const rail = RAILS[slug];
  if (!rail) throw badRequest('Unknown payment provider');

  const rawBody = await request.text();
  if (rawBody.length === 0) throw badRequest('Empty webhook body');
  if (rawBody.length > MAX_PAYLOAD_BYTES) throw badRequest('Webhook payload is too large');

  const acceptance = await ingestWebhook({
    provider: rail.provider,
    rawBody,
    headers: request.headers,
    airtelVariant: rail.airtelVariant,
  });

  if (!acceptance.signatureValid && rail.provider !== 'AIRTEL_MONEY') {
    throw unauthorized(`${rail.label} signature did not verify`);
  }

  return jsonBody(
    {
      received: true,
      handled: acceptance.handled,
      duplicate: acceptance.duplicate,
      outcome: acceptance.outcome,
    },
    200,
    // A callback is a fact about one payment; caching it would be actively wrong.
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
