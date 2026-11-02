import { z } from 'zod';
import { withRoute, readJson, jsonBody, created, privateCache, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { addProductImages } from '@/lib/services/products';
import { productImagesSchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/seller/products/{id}/images`
 *
 * Photos are uploaded to Cloudinary first and committed here, so a failed save never leaves
 * the platform paying for images nobody owns. A variant id on an entry attaches the shot to
 * that option — the black sofa and the beige one should not share a cover photo.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const { shop } = await requireSellerShop();
    const { id } = paramsSchema.parse(context.params);
    const input = await readJson(request, productImagesSchema);

    return created(await addProductImages(shop, id, input), privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
