import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { retireVariant, updateVariant } from '@/lib/services/products';
import { updateVariantSchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
  variantId: z.string().min(1).max(64),
});

/**
 * `PATCH /api/seller/products/{product}/variants/{variant}`
 *
 * Price, compare-at, cost, weight, per-order cap and the disabled flag. Stock is not here:
 * a unit count only changes through the ledger endpoint, so every carton that appeared or
 * vanished has a reason and an author attached to it.
 */
export const PATCH = withRoute<{ id: string; variantId: string }>(
  async (request: Request, context: RouteContext<{ id: string; variantId: string }>) => {
    const { shop } = await requireSellerShop();
    const { variantId } = paramsSchema.parse(context.params);
    const input = await readJson(request, updateVariantSchema);

    return jsonBody(await updateVariant(shop, variantId, input), 200, privateCache());
  },
);

/**
 * `DELETE /api/seller/products/{product}/variants/{variant}`
 *
 * Retired, not deleted: order items and stock movements keep their foreign key. Refused while
 * any unit is reserved in someone's basket, because a disappeared option leaves that buyer
 * staring at an order line with nothing behind it.
 */
export const DELETE = withRoute<{ id: string; variantId: string }>(
  async (_request: Request, context: RouteContext<{ id: string; variantId: string }>) => {
    const { shop } = await requireSellerShop();
    const { variantId } = paramsSchema.parse(context.params);

    return jsonBody(await retireVariant(shop, variantId), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
