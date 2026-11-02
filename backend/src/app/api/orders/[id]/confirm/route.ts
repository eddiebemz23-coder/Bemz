import { z } from 'zod';
import { withRoute, jsonBody, readJson, privateCache, tooManyRequests, type RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { confirmOrderByOtp } from '@/lib/services/orders';
import { orderConfirmSchema } from '@/lib/validation/commerce';
import { authLimiter } from '@/lib/rate-limit';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/orders/[id]/confirm`
 *
 * Spends the code and moves the order from AWAITING_CONFIRMATION to CONFIRMED, which is what
 * puts the parcel into the seller's queue.
 *
 * Two limits, not one: this route is the only place a code can be brute-forced, so guesses are
 * capped per device as well as by the code's own `maxAttempts` counter in `verifyOtp`.
 */
export const POST = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);

  const ipLimit = authLimiter(request, 'order-confirm');
  if (!ipLimit.allowed) {
    throw tooManyRequests('Too many attempts from this device — request a new code', ipLimit.retryAfterSeconds);
  }

  const { code } = await readJson(request, orderConfirmSchema);
  const result = await confirmOrderByOtp({ orderId: id, user, code });

  return jsonBody(
    {
      ...result,
      message: 'Confirmed. The seller has been told to pack your parcel.',
    },
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
