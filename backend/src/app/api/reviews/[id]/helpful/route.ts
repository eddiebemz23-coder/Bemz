import { z } from 'zod';
import { withRoute, jsonBody, RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { voteHelpful } from '@/lib/services/reviews';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/reviews/{id}/helpful`
 *
 * A toggle, and the uniqueness lives in the database (`ReviewVote` is unique on
 * `reviewId + userId`), so tapping twelve times in a row still counts once. Anonymous
 * visitors see the count but cannot change it.
 */
export const POST = withRoute<{ id: string }>(async (_request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);

  return jsonBody(await voteHelpful(user.id, id), 200);
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
