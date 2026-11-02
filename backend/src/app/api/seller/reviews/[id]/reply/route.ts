import { z } from 'zod';
import { withRoute, readJson, jsonBody, created, privateCache, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { replyAsSeller } from '@/lib/services/reviews';
import { sellerReplySchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/seller/reviews/{id}/reply`
 *
 * One public reply per review, shown under the buyer's stars. The service checks the review
 * belongs to this shop — either a shop review or a review of one of its listings — so a seller
 * cannot answer a complaint about a competitor.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const { shop } = await requireSellerShop();
    const { id } = paramsSchema.parse(context.params);
    const { reply } = await readJson(request, sellerReplySchema);

    return created(await replyAsSeller(shop, id, reply), privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
