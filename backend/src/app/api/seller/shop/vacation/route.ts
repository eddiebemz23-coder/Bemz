import { withRoute, jsonBody, readJson, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { setVacationMode } from '@/lib/services/shops';
import { vacationSchema } from '@/lib/validation/catalog';

/**
 * `POST /api/seller/shop/vacation`
 *
 * Holiday mode pauses the stall without deleting anything: listings stay readable, but checkout
 * rejects them so a buyer cannot order from a shop whose owner is upcountry. It is a switch, not
 * a delete, because a trader who closes for a week must not lose two years of sales history.
 */
export const POST = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const { on } = await readJson(request, vacationSchema);

  return jsonBody(await setVacationMode(shop, on), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
