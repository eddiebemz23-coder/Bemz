import { z } from 'zod';
import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { pendingReviewTargets } from '@/lib/services/reviews';

const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(20).default(8) });

/**
 * `GET /api/me/reviews/pending`
 *
 * The "rate your purchase" strip. It is derived from DELIVERED orders the buyer has not
 * reviewed yet, so a parcel still on a rider's bike never asks for a five-star rating.
 */
export const GET = withRoute(async (request: Request) => {
  const user = await requireUser();
  const { limit } = parseQuery(request, querySchema);

  return jsonBody({ items: await pendingReviewTargets(user.id, limit) }, 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
