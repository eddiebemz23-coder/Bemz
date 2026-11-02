import { z } from 'zod';
import { withRoute, readJson, created, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { addVariant, getSellerProduct } from '@/lib/services/products';
import { createVariantSchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `GET /api/seller/products/{id}/variants`
 *
 * Options carry price, stock and reserved stock. `available` is what a buyer can actually put
 * in a cart right now — the gap between `stockQuantity` and `available` is carts and unpaid
 * orders holding parcels back.
 */
export const GET = withRoute<{ id: string }>(
  async (_request: Request, context: RouteContext<{ id: string }>) => {
    const { shop } = await requireSellerShop();
    const { id } = paramsSchema.parse(context.params);

    const product = await getSellerProduct(shop, id);
    return jsonBody(
      {
        productId: product.id,
        currency: product.currency,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          sku: variant.sku,
          name: variant.name,
          priceMinor: variant.priceMinor,
          compareAtPriceMinor: variant.compareAtPriceMinor,
          costPriceMinor: variant.costPriceMinor,
          stockQuantity: variant.stockQuantity,
          reservedQuantity: variant.reservedQuantity,
          available: Math.max(0, variant.stockQuantity - variant.reservedQuantity),
          movementCount: variant._count.inventoryMovements,
          isDisabled: variant.isDisabled,
          isPrimary: variant.isPrimary,
        })),
      },
      200,
      privateCache(),
    );
  },
);

/**
 * `POST /api/seller/products/{id}/variants`
 *
 * A new option inherits the product's currency — a listing priced in UGX that grows a KES
 * variant would break every grid, quote and payout that reads the shop's single currency.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const { shop } = await requireSellerShop();
    const { id } = paramsSchema.parse(context.params);
    const input = await readJson(request, createVariantSchema);

    return created(await addVariant(shop, id, input), privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
