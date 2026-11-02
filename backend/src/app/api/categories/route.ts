import { withRoute, jsonBody, parseQuery, publicCatalogCache } from '@/lib/http';
import { categoryTree } from '@/lib/services/categories';
import { categoryTreeQuerySchema } from '@/lib/validation/catalog';

/**
 * `GET /api/categories`
 *
 * One level of the tree, with a live purchasable count per node. `parentId` accepts either the
 * id or the slug, because the homepage nav knows slugs and the admin tree knows ids.
 *
 * Cached: this is the same response for every visitor. The count is honest rather than
 * materialised — it drifts by minutes at worst, and a stale "12 345 items" badge on a
 * category chip is not worth a counter table.
 */
export const GET = withRoute(async (request: Request) => {
  const query = parseQuery(request, categoryTreeQuerySchema);
  return jsonBody(await categoryTree(query), 200, publicCatalogCache(120));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
