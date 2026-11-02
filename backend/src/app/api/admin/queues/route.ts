import { withRoute, jsonBody, privateCache } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { moderationQueues } from '@/lib/services/moderation';

/**
 * `GET /api/admin/queues`
 *
 * The four piles a platform team works through in the morning: listings waiting for approval,
 * shops waiting to open, KYC batches waiting for a document check, and reviews on hold.
 *
 * Counts are computed on read rather than denormalised — these queues are small, and a counter
 * that drifts is worse than a `COUNT` on a table with an index on `status`.
 */
export const GET = withRoute(async () => {
  await requireAdmin();
  return jsonBody(await moderationQueues(), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
