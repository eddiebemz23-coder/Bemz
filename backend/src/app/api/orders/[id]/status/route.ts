import { z } from 'zod';
import { withRoute, jsonBody, readJson, privateCache, type RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { sellerTransition } from '@/lib/services/orders';
import { sellerOrderTransitionSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/orders/[id]/status`
 *
 * The seller walks their own parcel forward: CONFIRMED → PACKED → OUT_FOR_DELIVERY → DELIVERED.
 * Ownership is proved inside the service from the order's shop, so a seller posting another
 * shop's order id is refused rather than quietly filtered.
 *
 * Two side effects happen here and neither is optional bookkeeping:
 *   - PACKED converts the checkout reservation into a real stock deduction and writes the
 *     `SALE` inventory movement with an idempotency key, so a double-tap cannot oversell;
 *   - DELIVERED settles a cash-on-delivery payment, because the rider holding the cash is the
 *     moment the platform's money actually exists.
 *
 * `consumedStock` is explicit rather than implied by the target status: a seller who packed
 * with the wrong count can re-pack without moving the ledger twice.
 */
export const POST = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);
  const body = await readJson(request, sellerOrderTransitionSchema);

  const order = await sellerTransition({
    orderId: id,
    user,
    to: body.to,
    note: body.note ?? null,
    trackingNumber: body.trackingNumber ?? null,
    courierName: body.courierName ?? null,
    consumedStock: body.consumedStock,
  });

  return jsonBody(order, 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
