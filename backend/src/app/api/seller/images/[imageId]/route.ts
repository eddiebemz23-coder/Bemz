import { z } from 'zod';
import { withRoute, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { deleteProductImage } from '@/lib/services/products';

const paramsSchema = z.object({ imageId: z.string().min(1).max(64) });

/**
 * `DELETE /api/seller/images/{imageId}`
 *
 * The row goes and so does the Cloudinary asset — an orphaned original keeps billing for
 * storage on a listing that no longer shows it. If the deleted photo was the cover, the next
 * one in position order is promoted in the same transaction, so a listing never renders blank.
 */
export const DELETE = withRoute<{ imageId: string }>(
  async (_request: Request, context: RouteContext<{ imageId: string }>) => {
    const { shop } = await requireSellerShop();
    const { imageId } = paramsSchema.parse(context.params);

    return jsonBody(await deleteProductImage(shop, imageId), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
