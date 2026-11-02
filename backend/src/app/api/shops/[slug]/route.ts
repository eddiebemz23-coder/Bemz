import { z } from 'zod';
import { withRoute, jsonBody, publicCatalogCache, RouteContext } from '@/lib/http';
import { getShopBySlug } from '@/lib/services/shops';

const paramsSchema = z.object({ slug: z.string().min(2).max(80) });

/**
 * `GET /api/shops/{slug}`
 *
 * The stall page in one call: card, categories it actually has stock in, star breakdown and
 * newest listings. Cached publicly — everything in here is already on the shelf.
 */
export const GET = withRoute<{ slug: string }>(async (_request: Request, context: RouteContext<{ slug: string }>) => {
  const { slug } = paramsSchema.parse(context.params);
  return jsonBody(await getShopBySlug(slug), 200, publicCatalogCache(30));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
