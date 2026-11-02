import { withRoute, jsonBody, readJson, parseQuery, created, publicCatalogCache, privateCache } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { listPublicShops } from '@/lib/services/shops';
import { createShop } from '@/lib/services/accounts';
import { createShopSchema, shopQuerySchema } from '@/lib/validation/catalog';

/**
 * `GET /api/shops`
 *
 * Discovery grid. A PENDING or SUSPENDED stall is not in here: it still exists for its owner
 * and for support, but it is not sellable, and a shop list that shows closed stalls generates
 * orders nobody will dispatch.
 */
export const GET = withRoute(async (request: Request) => {
  const query = parseQuery(request, shopQuerySchema);
  return jsonBody(await listPublicShops(query), 200, publicCatalogCache(30));
});

/**
 * `POST /api/shops`
 *
 * Opening a stall is deliberately cheap — it lands as `PENDING` and only goes live when a
 * reviewer approves the KYC. A signed-in buyer may use this: creating the shop also promotes
 * the account to `SELLER`, so the dashboard is reachable the moment the tab reloads.
 *
 * One shop per account, enforced in the service: a second call returns 409 rather than
 * silently splitting a trader's order history across two stalls.
 */
export const POST = withRoute(async (request: Request) => {
  const user = await requireUser();
  const input = await readJson(request, createShopSchema);
  const shop = await createShop(user.id, input);

  return created({ shop }, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
