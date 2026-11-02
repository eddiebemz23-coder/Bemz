import { z } from 'zod';
import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { effectiveCommissionBps } from '@/lib/services/shops';
import { optionalText } from '@/lib/validation/common';

const querySchema = z.object({ categoryId: optionalText(64) });

/**
 * `GET /api/seller/commission`
 *
 * The rate the platform will actually take, resolved in the same precedence the payout uses:
 * a negotiated shop override beats the category rate, which beats the platform default. A
 * seller who sees "10%" here and 7% on their payout would open a dispute, so the dashboard
 * reads from the same function the ledger does.
 */
export const GET = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const { categoryId } = parseQuery(request, querySchema);
  const commissionBps = await effectiveCommissionBps(shop, categoryId ?? undefined);

  return jsonBody(
    {
      commissionBps,
      commissionPct: Number((commissionBps / 100).toFixed(2)),
      shopOverride: shop.commissionRateBps !== null,
      categoryId: categoryId ?? null,
    },
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
