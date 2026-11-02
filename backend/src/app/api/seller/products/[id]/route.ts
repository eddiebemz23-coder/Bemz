import { z } from 'zod';
import { withRoute, jsonBody, readJson, privateCache, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { getSellerProductDetail, retireProduct, updateProduct } from '@/lib/services/products';
import { updateProductSchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/** `GET /api/seller/products/{id}` — everything the listing editor binds to. */
export const GET = withRoute<{ id: string }>(async (_request: Request, context: RouteContext<{ id: string }>) => {
  const { shop } = await requireSellerShop();
  const { id } = paramsSchema.parse(context.params);

  return jsonBody(await getSellerProductDetail(shop, id), 200, privateCache());
});

/**
 * `PATCH /api/seller/products/{id}`
 *
 * Text, category links and status only. Prices and stock are variants and go through the
 * variant/stock endpoints, which is where the inventory ledger gets written — an editor that
 * could set `priceMinor` here would be an editor that skips the audit trail.
 *
 * Setting `status: 'ACTIVE'` on a rejected listing re-queues it for review rather than
 * publishing it; the service decides, not the client.
 */
export const PATCH = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const { shop } = await requireSellerShop();
  const { id } = paramsSchema.parse(context.params);
  const patch = await readJson(request, updateProductSchema);

  return jsonBody(await updateProduct(shop, id, patch), 200, privateCache());
});

/**
 * `DELETE /api/seller/products/{id}`
 *
 * Soft delete. Orders already placed must keep their title, price and image for the buyer's
 * receipt and for a dispute, so the row stays and `deletedAt` hides it from every read path.
 */
export const DELETE = withRoute<{ id: string }>(async (_request: Request, context: RouteContext<{ id: string }>) => {
  const { shop } = await requireSellerShop();
  const { id } = paramsSchema.parse(context.params);

  return jsonBody(await retireProduct(shop, id), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
