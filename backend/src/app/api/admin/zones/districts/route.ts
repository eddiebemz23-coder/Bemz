import { withRoute, readJson, jsonBody, privateCache } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { assignDistrictZone } from '@/lib/services/geo';
import { adminDistrictZoneSchema } from '@/lib/validation/commerce';

/**
 * `POST /api/admin/zones/districts`
 *
 * Moving a town into a delivery zone is how coverage actually expands: a district with no zone
 * returns `zone: null` and cannot be checked out to, so this write is the switch that turns a
 * place on. A zone in Uganda is refused for a Kenyan district — fees, VAT and the courier
 * contract are all per-country, and a cross-border mismatch would price an order in the wrong
 * currency for a parcel that has to clear customs.
 */
export const POST = withRoute(async (request: Request) => {
  const admin = await requireAdmin();
  const { districtId, zoneId } = await readJson(request, adminDistrictZoneSchema);

  return jsonBody(await assignDistrictZone(districtId, zoneId, admin.id), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
