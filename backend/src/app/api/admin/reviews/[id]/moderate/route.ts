import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { moderateReview } from '@/lib/services/reviews';
import { adminReviewModerationSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/admin/reviews/{id}/moderate`
 *
 * PUBLISH, REMOVE or HOLD. Removal recalculates the product or shop average in the same
 * transaction, so a review taken down for abuse stops bending the rating the moment it stops
 * showing. The row survives for the appeal and for the audit trail.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const admin = await requireAdmin();
    const { id } = paramsSchema.parse(context.params);
    const { decision, reason } = await readJson(request, adminReviewModerationSchema);

    return jsonBody(await moderateReview(id, { decision, reason, actorId: admin.id }), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
