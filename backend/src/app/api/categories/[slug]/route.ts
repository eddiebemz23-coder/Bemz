import { z } from 'zod';
import { withRoute, jsonBody, publicCatalogCache, RouteContext } from '@/lib/http';
import { categoryLanding } from '@/lib/services/categories';

const paramsSchema = z.object({ slug: z.string().min(2).max(120) });

/**
 * `GET /api/categories/{slug}`
 *
 * Everything the landing page needs above the fold: breadcrumb, children, and the facet lists
 * that build the filter rail. Price bands come back per currency on purpose — UGX 50 000 and
 * KES 50 000 are not the same money, so a single min/max slider would be a lie in one of the
 * two markets.
 *
 * The product grid itself is a separate `GET /api/products?categorySlug=…` call so paging and
 * sorting never re-prune the facets.
 */
export const GET = withRoute<{ slug: string }>(async (_request: Request, context: RouteContext<{ slug: string }>) => {
  const { slug } = paramsSchema.parse(context.params);
  return jsonBody(await categoryLanding(slug), 200, publicCatalogCache(60));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
