import { z } from 'zod';
import { withRoute, jsonBody, privateCache, type RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { getOrderDetail } from '@/lib/services/orders';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `GET /api/orders/[id]`
 *
 * The full trail: line items at the price paid, the address snapshot from the day it was
 * ordered, every status change with who made it, the payments, the refunds and the delivery
 * dates. This is what a dispute is settled from, so nothing here is recomputed from current
 * product data — an order shows what was promised.
 *
 * The service answers the authorisation question (`loadAuthorisedOrder`): buyer, the seller of
 * that parcel, or an admin. Everyone else gets a 403 without learning whether the id exists.
 */
export const GET = withRoute<{ id: string }>(async (_request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);
  return jsonBody(await getOrderDetail(id, user), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
