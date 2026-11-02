import { z } from 'zod';
import { withRoute, created, privateCache, tooManyRequests, type RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { requestOrderConfirmCode } from '@/lib/services/orders';
import { authLimiter } from '@/lib/rate-limit';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/orders/[id]/confirm/request`
 *
 * Asks for the code that turns a cash-on-delivery order into a confirmed one. The number it
 * goes to is read off the order, never taken from the request body — otherwise a caller could
 * use the platform's SMS credit as a messaging relay to any phone on the network.
 */
export const POST = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);

  // Per-device ceiling first; the per-number resend cooldown lives inside `requestOtp`.
  const ipLimit = authLimiter(request, 'order-confirm-code');
  if (!ipLimit.allowed) {
    throw tooManyRequests('Codes are already on their way for this order', ipLimit.retryAfterSeconds);
  }

  return created(await requestOrderConfirmCode(id, user), privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
