import { z } from 'zod';
import { withRoute, jsonBody, readJson, type RouteContext } from '@/lib/http';
import { basketHeaders, basketHolderFromRequest } from '@/lib/auth/guards';
import { removeCartItem, updateCartItem } from '@/lib/services/cart';
import { updateCartItemSchema } from '@/lib/validation/commerce';

const itemParams = z.object({ itemId: z.string().min(1).max(64) });

/**
 * `PATCH /api/cart/[itemId]`
 *
 * Quantity is re-checked against live stock here, not only against the number the page
 * rendered minutes ago. `selected: false` short-circuits: unticking a line must work even
 * when the item has sold out, otherwise a buyer cannot clear it from the basket.
 */
export const PATCH = withRoute(async (request: Request, context: RouteContext<{ itemId: string }>) => {
  const holder = await basketHolderFromRequest(request);
  const { itemId } = itemParams.parse(context.params);

  const body = await readJson(request, updateCartItemSchema);
  return jsonBody(await updateCartItem(holder, { itemId, quantity: body.quantity, selected: body.selected }), 200, basketHeaders(holder));
});

/**
 * `DELETE /api/cart/[itemId]`
 *
 * The delete is scoped to the caller's own cart in the service, so a guessed item id from
 * someone else's basket is a 404 rather than a removed line.
 */
export const DELETE = withRoute(async (request: Request, context: RouteContext<{ itemId: string }>) => {
  const holder = await basketHolderFromRequest(request);
  const { itemId } = itemParams.parse(context.params);
  return jsonBody(await removeCartItem(holder, itemId), 200, basketHeaders(holder));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
