import { z } from 'zod';
import { withRoute, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { withdrawPayoutRequest } from '@/lib/services/payouts';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/seller/payouts/{id}/withdraw`
 *
 * Only a request finance has not picked up yet can be withdrawn. Once it is APPROVED the money
 * is committed and the seller has to talk to a person, because cancelling at that point would
 * leave an approved transfer with no recipient.
 */
export const POST = withRoute<{ id: string }>(async (_request: Request, context: RouteContext<{ id: string }>) => {
  const { shop } = await requireSellerShop();
  const { id } = paramsSchema.parse(context.params);

  return jsonBody(await withdrawPayoutRequest(shop, id), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
