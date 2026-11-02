import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { shopQuestions } from '@/lib/services/reviews';
import { sellerQuestionQuerySchema } from '@/lib/validation/catalog';

/**
 * `GET /api/seller/questions`
 *
 * Buyer questions across every listing in the shop, unanswered ones first. A question left
 * sitting on a live listing is a sale lost to the trader who answered theirs, so this is the
 * seller's inbox rather than an archive.
 */
export const GET = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const query = parseQuery(request, sellerQuestionQuerySchema);

  return jsonBody(
    {
      items: await shopQuestions(shop.id, {
        unansweredOnly: query.unansweredOnly === 'true',
        perPage: query.perPage,
      }),
    },
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
