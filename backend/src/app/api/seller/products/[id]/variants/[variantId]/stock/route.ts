import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { adjustStock } from '@/lib/services/products';
import { stockAdjustmentSchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({
  id: z.string().min(1).max(64),
  variantId: z.string().min(1).max(64),
});

/**
 * `POST /api/seller/products/{product}/variants/{variant}/stock`
 *
 * The only door to a unit count, and it moves a *delta* rather than an absolute number.
 * Counting the shelf and typing "37" would overwrite stock that a buyer reserved between the
 * count and the save; `+12` cannot.
 *
 * `idempotencyKey` is required: a retry over a 3G link must not restock twice. Re-sending the
 * same key returns the original movement with `duplicate: true`.
 */
export const POST = withRoute<{ id: string; variantId: string }>(
  async (request: Request, context: RouteContext<{ id: string; variantId: string }>) => {
    const { user, shop } = await requireSellerShop();
    const { variantId } = paramsSchema.parse(context.params);
    const input = await readJson(request, stockAdjustmentSchema);

    return jsonBody(await adjustStock(shop, variantId, input, user.id), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
