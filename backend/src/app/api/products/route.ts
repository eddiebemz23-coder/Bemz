import { withRoute, jsonBody, parseQuery, publicCatalogCache, privateCache } from '@/lib/http';
import { getSessionUser } from '@/lib/auth/guards';
import { listPublicProducts } from '@/lib/services/products';
import { wishlistStatus } from '@/lib/services/wishlist';
import { productQuerySchema } from '@/lib/validation/catalog';

/**
 * `GET /api/products`
 *
 * The listing grid: search, category subtree, shop, brand, price band, variant attributes,
 * rating and sort, all paginated.
 *
 * The cache header follows the response. Once a signed-in buyer's saved-item hearts are
 * folded in, the body is personal, so a shared CDN cache must not hold it — otherwise one
 * buyer's page serves another's favourites.
 */
export const GET = withRoute(async (request: Request) => {
  const query = parseQuery(request, productQuerySchema);
  const result = await listPublicProducts(query);
  const user = await getSessionUser();

  if (!user) {
    return jsonBody({ ...result, personalised: false }, 200, publicCatalogCache(15));
  }

  const saved = await wishlistStatus(user.id, result.items.map((item) => item.id));
  const savedSet = new Set(saved.saved);

  return jsonBody(
    {
      ...result,
      personalised: true,
      wishlistCount: saved.count,
      items: result.items.map((item) => ({ ...item, isSaved: savedSet.has(item.id) })),
    },
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
