import { withRoute, jsonBody, parseQuery, privateCache } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { auditTrail } from '@/lib/services/moderation';
import { auditQuerySchema } from '@/lib/validation/commerce';

/**
 * `GET /api/admin/audit`
 *
 * Who changed what, when and why — every ban, KYC decision, payout, commission edit and takedown
 * is a row here with a named actor and a reason. Filters by entity, entity id or actor.
 *
 * This is read-only by construction: there is no route that writes or edits an audit row, and
 * there never will be. A log the platform can quietly rewrite is not evidence.
 */
export const GET = withRoute(async (request: Request) => {
  await requireAdmin();
  const query = parseQuery(request, auditQuerySchema);

  return jsonBody(
    await auditTrail({
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      page: query.page,
      perPage: query.perPage,
    }),
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
