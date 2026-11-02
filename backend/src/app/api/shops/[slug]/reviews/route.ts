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
import { getShopBySlug } from '@/lib/services/shops';
import { createReview, listShopReviews } from '@/lib/services/reviews';
import { reviewBodySchema, reviewQuerySchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({ slug: z.string().min(2).max(80) });

/**
 * `GET /api/shops/{slug}/reviews`
 *
 * Shop ratings are about the trader, not the item: dispatch speed, whether the parcel matched
 * the photo, how the rider handled cash. They are stored separately from product reviews so a
 * slow courier never drags down a good pair of shoes.
 */
export const GET = withRoute<{ slug: string }>(
  async (request: Request, context: RouteContext<{ slug: string }>) => {
    const { slug } = paramsSchema.parse(context.params);
    const { shop } = await getShopBySlug(slug);
    const query = parseQuery(request, reviewQuerySchema);
    const viewer = await getSessionUser();

    const result = await listShopReviews(shop.id, query, viewer?.id);
    return jsonBody(result, 200, viewer ? privateCache() : publicCatalogCache(30));
  },
);

/**
 * `POST /api/shops/{slug}/reviews`
 *
 * One shop review per person per stall (unique check in the service), and the target comes from
 * the URL so the rating lands on the shop the buyer was looking at.
 */
export const POST = withRoute<{ slug: string }>(
  async (request: Request, context: RouteContext<{ slug: string }>) => {
    const user = await requireUser();
    const { slug } = paramsSchema.parse(context.params);
    const { shop } = await getShopBySlug(slug);
    const body = await readJson(request, reviewBodySchema);

    const review = await createReview(user.id, {
      ...body,
      targetType: 'SHOP',
      productId: undefined,
      shopId: shop.id,
    });

    return created({ review }, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
