import { z } from 'zod';
import { withRoute, readJson, created, RouteContext } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { answerQuestion } from '@/lib/services/reviews';
import { answerSchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/seller/questions/{id}/answer`
 *
 * The shop must own the listing the question sits on (checked in the service), and the answer is
 * tagged `isFromSeller` so the product page can show it as the trader speaking, not as another
 * buyer guessing.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const { user, shop } = await requireSellerShop();
    const { id } = paramsSchema.parse(context.params);
    const { body } = await readJson(request, answerSchema);

    return created(await answerQuestion({ shopId: shop.id, questionId: id, body, userId: user.id }));
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
