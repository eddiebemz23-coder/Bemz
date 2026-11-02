import { z } from 'zod';
import { withRoute, jsonBody, readJson, privateCache, type RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { cancelOrder } from '@/lib/services/orders';
import { cancelOrderSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/orders/[id]/cancel`
 *
 * Buyer, seller or admin — the service works out which one is speaking and applies that
 * role's window: a buyer can stop an order until it is confirmed, a seller until the parcel is
 * packed, and an admin at any point before it is already closed.
 *
 * `restock` is the part that needs the human's judgement. Units that never left the stall go
 * back on the shelf; units already in a rider's hands come back as a return, after inspection,
 * so the stock count is not quietly inflated with a phone that may not arrive.
 *
 * A cancellation is a status, never a delete: the payment, the address snapshot and the
 * status history stay queryable for the dispute trail.
 */
export const POST = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);
  const body = await readJson(request, cancelOrderSchema);

  const order = await cancelOrder({ orderId: id, user, reason: body.reason, restock: body.restock });
  return jsonBody({ ...order, message: 'Order cancelled. Any payment taken is queued for a refund.' }, 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
