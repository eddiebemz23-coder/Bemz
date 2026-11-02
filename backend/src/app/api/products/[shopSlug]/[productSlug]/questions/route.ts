import { z } from 'zod';
import {
  withRoute,
  jsonBody,
  readJson,
  created,
  publicCatalogCache,
  RouteContext,
} from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { getProductForShop } from '@/lib/services/products';
import { askQuestion, listQuestions } from '@/lib/services/reviews';
import { questionSchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({
  shopSlug: z.string().min(2).max(80),
  productSlug: z.string().min(2).max(160),
});

/**
 * `GET /api/products/{shop}/{product}/questions`
 *
 * Public and answered-first: the thread doubles as product copy, so a buyer who cannot read
 * it cannot be helped by it. Anonymous reads are cacheable because nothing here is personal.
 */
export const GET = withRoute<{ shopSlug: string; productSlug: string }>(
  async (_request: Request, context: RouteContext<{ shopSlug: string; productSlug: string }>) => {
    const { shopSlug, productSlug } = paramsSchema.parse(context.params);
    const product = await getProductForShop(shopSlug, productSlug);
    return jsonBody({ productId: product.id, questions: await listQuestions(product.id) }, 200, publicCatalogCache(60));
  },
);

/**
 * `POST /api/products/{shop}/{product}/questions`
 *
 * Asking is signed-in: the duplicate guard and the abuse rate limit both need a user id, and
 * a listing that lets anonymous visitors post text becomes a comment-spam surface.
 */
export const POST = withRoute<{ shopSlug: string; productSlug: string }>(
  async (request: Request, context: RouteContext<{ shopSlug: string; productSlug: string }>) => {
    const user = await requireUser();
    const { shopSlug, productSlug } = paramsSchema.parse(context.params);
    const product = await getProductForShop(shopSlug, productSlug);
    const { body } = await readJson(request, questionSchema);

    const question = await askQuestion(user.id, product.id, body);
    return created({ question });
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
