import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { moderateProduct } from '@/lib/services/moderation';
import { adminModerationSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/admin/products/{id}/moderate`
 *
 * Approving publishes, rejecting keeps the listing intact with a reason the seller can read —
 * moderation is a status, never a delete. A rejected seller who finds their work simply gone
 * assumes sabotage and leaves; one who is told "the photos are of a different item" fixes it.
 *
 * Every decision writes an `AuditLog` row naming the admin, because a marketplace that can hide
 * why it suppressed a trader is not one a trader will trust with their stock.
 */
export const POST = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const admin = await requireAdmin();
    const { id } = paramsSchema.parse(context.params);
    const { decision, reason } = await readJson(request, adminModerationSchema);

    return jsonBody(await moderateProduct(id, { decision, reason, actorId: admin.id }), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
