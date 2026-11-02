import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { setProductStatus } from '@/lib/services/products';
import { productStatusSchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/seller/products/{id}/status`
 *
 * `DRAFT`, `ACTIVE` or `ARCHIVED` — and `PENDING_REVIEW` is deliberately absent. A seller asks
 * to be published; whether they are is the moderator's call, so an unapproved listing (or one
 * already rejected) is put back in the queue instead of going live.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const { shop } = await requireSellerShop();
    const { id } = paramsSchema.parse(context.params);
    const { status } = await readJson(request, productStatusSchema);

    return jsonBody(await setProductStatus(shop, id, status), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
