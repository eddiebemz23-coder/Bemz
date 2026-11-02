import { withRoute, jsonBody, readJson, parseQuery, created, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { payoutHistory, payoutSummary, requestPayout } from '@/lib/services/payouts';
import { payoutListQuerySchema, payoutWindowSchema } from '@/lib/validation/commerce';

/**
 * `GET /api/seller/payouts`
 *
 * The balance page: what has cleared, what is still inside the dispute window, what is already
 * requested, and why withdrawal is blocked if it is. `blockers` is a list of sentences rather
 * than a flag because "you cannot withdraw" with no reason is how a seller ends up in support
 * chat instead of uploading their ID.
 *
 * Cash collected by a rider on a COD delivery is reported separately: the platform never held
 * it, so it is not in any payout here.
 */
export const GET = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const query = parseQuery(request, payoutListQuerySchema);

  const [summary, history] = await Promise.all([
    payoutSummary(shop),
    payoutHistory(shop.id, { page: query.page, perPage: query.perPage }),
  ]);

  return jsonBody({ summary, history }, 200, privateCache());
});

/**
 * `POST /api/seller/payouts`
 *
 * The seller picks a *period*, never an amount: the figure is recomputed from delivered, paid,
 * past-dispute-window orders in that window. Overlapping windows are refused, because with no
 * order-to-payout join table the period is the only thing tying money to parcels — two requests
 * covering the same fortnight would pay the same orders twice.
 */
export const POST = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const window = await readJson(request, payoutWindowSchema);

  return created(await requestPayout(shop, window), privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
