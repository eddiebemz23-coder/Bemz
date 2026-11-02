import { z } from 'zod';
import { withRoute, jsonBody, created, privateCache, type RouteContext, tooManyRequests } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { initiatePayment, loadPaymentForBuyer, paymentView } from '@/lib/payments';
import { consume } from '@/lib/rate-limit';

const paramsSchema = z.object({ id: z.string().min(8).max(64) });

/**
 * `POST /api/payments/[id]/initiate`
 *
 * Pushes the PIN prompt to the buyer's handset again — used when the checkout response was
 * lost on a poor connection but the order and its payment row were already saved.
 *
 * This does not create anything, so it is safe to retry: `initiatePayment` reuses the payment's
 * own `externalId`, which is the idempotency key the operator dedupes on. A buyer tapping
 * "send me the prompt" five times gets one charge, not five.
 */
export const POST = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);

  const limit = consume(`payment-initiate:${user.id}`, 10, 60);
  if (!limit.allowed) {
    throw tooManyRequests('The prompt is already on its way — check your messages', limit.retryAfterSeconds);
  }

  const owned = await loadPaymentForBuyer(id, user);
  const result = await initiatePayment(owned.id);

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
