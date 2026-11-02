import { z } from 'zod';
import { withRoute, jsonBody, publicCatalogCache, RouteContext } from '@/lib/http';
import { getDistrict } from '@/lib/services/geo';

const paramsSchema = z.object({ id: z.coerce.number().int().positive().max(100_000) });

/**
 * `GET /api/geo/districts/{id}`
 *
 * The single lookup an order confirmation needs: which zone this stop is in, what it costs to
 * reach, and whether a rider carrying cash is allowed to come at all.
 */
export const GET = withRoute<{ id: string }>(async (_request: Request, context: RouteContext<{ id: string }>) => {
  const { id } = paramsSchema.parse(context.params);
  return jsonBody(await getDistrict(id), 200, publicCatalogCache(600));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
