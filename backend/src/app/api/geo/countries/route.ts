import { withRoute, jsonBody, publicCatalogCache } from '@/lib/http';
import { listCountries } from '@/lib/services/geo';

/**
 * `GET /api/geo/countries`
 *
 * Two markets, one tiny table. The currency switcher, the phone-prefix field and the VAT label
 * on a receipt all read `taxLabel` from here rather than hardcoding "UGX" or "KRA VAT" in the
 * client, so adding a third market is a row and not a release.
 */
export const GET = withRoute(async () => jsonBody({ countries: await listCountries() }, 200, publicCatalogCache(3600)));

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
