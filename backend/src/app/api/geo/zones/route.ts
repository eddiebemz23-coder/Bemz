import { z } from 'zod';
import { withRoute, jsonBody, parseQuery, publicCatalogCache } from '@/lib/http';
import { listZones } from '@/lib/services/geo';

const querySchema = z.object({ country: z.enum(['UG', 'KE']).optional() });

/**
 * `GET /api/geo/zones`
 *
 * The priced shipping map: base fee, weight surcharge, free-shipping threshold, transit days
 * and whether cash on delivery runs there — plus the district count, so ops can see at a glance
 * that a zone covering three districts is not the same as one covering thirty.
 */
export const GET = withRoute(async (request: Request) => {
  const { country } = parseQuery(request, querySchema);
  return jsonBody({ zones: await listZones(country) }, 200, publicCatalogCache(600));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
