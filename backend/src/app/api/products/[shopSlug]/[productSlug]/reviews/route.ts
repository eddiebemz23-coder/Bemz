import { z } from 'zod';
import {
  withRoute,
  jsonBody,
  readJson,
  parseQuery,
  created,
  publicCatalogCache,
  privateCache,
  RouteContext,
} from '@/lib/http';
import { getSessionUser, requireUser } from '@/lib/auth/guards';
import { getProductForShop } from '@/lib/services/products';
import { createReview, listProductReviews } from '@/lib/services/reviews';
import { reviewBodySchema, reviewQuerySchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({
  shopSlug: z.string().min(2).max(80),
  productSlug: z.string().min(2).max(160),
});

/** `/api/products/{shop}/{product}/reviews` — the review tab, star breakdown included. */
async function resolveProduct(context: RouteContext<{ shopSlug: string; productSlug: string }>) {
  const { shopSlug, productSlug } = paramsSchema.parse(context.params);
  return getProductForShop(shopSlug, productSlug);
}

export const GET = withRoute<{ shopSlug: string; productSlug: string }>(
  async (request: Request, context: RouteContext<{ shopSlug: string; productSlug: string }>) => {
    const product = await resolveProduct(context);
    const query = parseQuery(request, reviewQuerySchema);
    const viewer = await getSessionUser();

    const result = await listProductReviews(product.id, query, viewer?.id);
    return jsonBody(result, 200, viewer ? privateCache() : publicCatalogCache(30));
  },
);

/**
 * `POST /api/products/{shop}/{product}/reviews`
 *
 * `targetType` and `productId` are taken from the URL, never the body, so this endpoint can only
 * ever write a review of the listing in the path. `orderId` is optional but checked server-side:
 * the "verified purchase" badge is earned by a DELIVERED order, not claimed by the client.
 */
export const POST = withRoute<{ shopSlug: string; productSlug: string }>(
  async (request: Request, context: RouteContext<{ shopSlug: string; productSlug: string }>) => {
    const user = await requireUser();
    const product = await resolveProduct(context);
    const body = await readJson(request, reviewBodySchema);

    const review = await createReview(user.id, {
      ...body,
      targetType: 'PRODUCT',
      productId: product.id,
      shopId: undefined,
    });

    return created(
      {
        review,
        product: {
          id: product.id,
          ratingAvg: product.ratingAvg === null ? null : Number(product.ratingAvg),
          ratingCount: product.ratingCount,
        },
      },
      privateCache(),
    );
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
