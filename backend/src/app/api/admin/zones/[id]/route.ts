import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { updateZone } from '@/lib/services/geo';
import { adminZonePatchSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.coerce.number().int().positive().max(100_000) });

/**
 * `PATCH /api/admin/zones/{id}`
 *
 * Repricing delivery. An order snapshots its fee and its transit days at checkout, so a change
 * here only ever affects future quotes — a buyer who was shown UGX 5 000 is never re-charged
 * while their parcel is on a motorbike.
 *
 * `estimatedDaysMin > estimatedDaysMax` is refused: a promise can be vague, it cannot be
 * backwards.
 */
export const PATCH = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const admin = await requireAdmin();
    const { id } = paramsSchema.parse(context.params);
    const patch = await readJson(request, adminZonePatchSchema);

    return jsonBody(await updateZone(id, patch, admin.id), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
