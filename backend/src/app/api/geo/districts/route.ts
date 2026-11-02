import { withRoute, jsonBody, parseQuery, publicCatalogCache } from '@/lib/http';
import { listDistricts } from '@/lib/services/geo';
import { districtQuerySchema } from '@/lib/validation/commerce';

/**
 * `GET /api/geo/districts`
 *
 * The district picker behind every address form and the checkout stop. Two lists come back,
 * not one: `deliverable` is what a buyer may choose, `unreachable` is what we deliberately do
 * not serve yet. Hiding the second list would leave people entering "Kotido" into a text box
 * and blaming the app when the quote comes back empty.
 *
 * Long cache — this changes when ops adds a zone, not when a seller uploads a photo.
 */
export const GET = withRoute(async (request: Request) => {
  const query = parseQuery(request, districtQuerySchema);
  return jsonBody(await listDistricts(query), 200, publicCatalogCache(600));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
