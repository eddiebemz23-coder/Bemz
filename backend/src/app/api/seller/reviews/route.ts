import { z } from 'zod';
import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { shopReviewsToAnswer } from '@/lib/services/reviews';
import { reviewQuerySchema } from '@/lib/validation/catalog';

const querySchema = reviewQuerySchema.pick({ perPage: true });

/**
 * `GET /api/seller/reviews`
 *
 * Reviews about this shop that have no reply yet, newest first. A buyer who complained about a
 * late parcel and got silence will not order again; the same complaint with a reply that says
 * "dispatched today" often will.
 */
export const GET = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const { perPage } = parseQuery(request, querySchema);

  return jsonBody({ items: await shopReviewsToAnswer(shop.id, perPage) }, 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
