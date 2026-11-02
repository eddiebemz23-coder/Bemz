import { z } from 'zod';
import { withRoute, readJson, created, privateCache, unprocessable, type RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { loadPaymentForBuyer, paymentView, retryPayment } from '@/lib/payments';
import { retryPaymentSchema } from '@/lib/validation/commerce';
import { currencyForRegion, tryNormalisePhone } from '@/lib/phone';

const paramsSchema = z.object({ id: z.string().min(8).max(64) });

/**
 * `POST /api/payments/[id]/retry`
 *
 * Only a dead payment is retried. A prompt that is still waiting for a PIN is live, and
 * starting a second one beside it is how a buyer ends up paying twice for one parcel — the
 * service refuses that case rather than papering over it.
 *
 * The retry is a NEW payment row with a fresh `externalId`; the failed one is marked cancelled
 * and keeps its failure reason for reconciliation. Three attempts is the ceiling, because a
 * network that rejects a wallet three times usually has a limit or a wrong number, and the
 * buyer is better served by a phone call to support than by an infinite retry button.
 */
export const POST = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);
  const body = await readJson(request, retryPaymentSchema);

  const owned = await loadPaymentForBuyer(id, user);

  let payerPhone: string | null = null;
  if (body.payerPhone) {
    // The rail is tied to the market the goods are in: a Kenyan number cannot settle a UGX
    // invoice, and letting it through would only fail later at the operator.
    const parsed = tryNormalisePhone(body.payerPhone, owned.currency === 'KES' ? 'KE' : 'UG');
    if (!parsed.ok) throw unprocessable(parsed.message);
    if (currencyForRegion(parsed.phone.region) !== owned.currency) {
      throw unprocessable(`A ${parsed.phone.region} number cannot pay a ${owned.currency} invoice`);
    }
    payerPhone = parsed.phone.e164;
  }

  const result = await retryPayment(owned.id, { payerPhone });

  return created(
    {
      payment: paymentView(result.payment),
      instruction: result.instruction,
      redirectUrl: result.redirectUrl,
      orderNumber: owned.order?.orderNumber ?? null,
    },
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
