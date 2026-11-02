import { z } from 'zod';
import { withRoute, jsonBody, readJson, RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { deleteOwnReview, editReview } from '@/lib/services/reviews';
import { reviewEditSchema } from '@/lib/validation/catalog';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `PATCH /api/reviews/{id}`
 *
 * The author only, and the rating is mandatory: a buyer who changes their mind about a
 * three-star experience usually means the stars as well as the words. Product and shop
 * averages are recomputed inside the same transaction.
 */
export const PATCH = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);
  const patch = await readJson(request, reviewEditSchema);

  return jsonBody(await editReview(user.id, id, patch), 200);
});

/**
 * `DELETE /api/reviews/{id}`
 *
 * Hard-deleting the author's own row is safe: the denormalised averages are recalculated from
 * the surviving PUBLISHED set, so nothing is left pointing at a review that is gone. A review
 * *removed by moderation* takes a different path and keeps its row for the appeal.
 */
export const DELETE = withRoute<{ id: string }>(async (_request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);

  return jsonBody(await deleteOwnReview(user.id, id));
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
