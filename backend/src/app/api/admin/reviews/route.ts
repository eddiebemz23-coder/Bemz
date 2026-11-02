import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { reviewModerationQueue } from '@/lib/services/reviews';
import { reviewQueueQuerySchema } from '@/lib/validation/catalog';

/**
 * `GET /api/admin/reviews`
 *
 * The default is the PENDING pile. Reviews are published immediately on creation — the queue
 * exists for reports and for the small share the platform holds back, not to sit on every
 * five-star note from a buyer in Mbale.
 */
export const GET = withRoute(async (request: Request) => {
  await requireAdmin();
  const query = parseQuery(request, reviewQueueQuerySchema);

  return jsonBody(
    await reviewModerationQueue({
      status: query.status ?? 'PENDING',
      page: query.page,
      perPage: query.perPage,
    }),
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
