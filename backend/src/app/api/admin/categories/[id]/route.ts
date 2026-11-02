import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { updateCategory } from '@/lib/services/categories';
import { adminCategoryPatchSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `PATCH /api/admin/categories/{id}`
 *
 * Renaming or reparenting rewrites the materialised `path` of the whole subtree, because every
 * category page, filter and KYC gate reads that prefix — a stale parent slug would drop every
 * listing below it off the site without an error anywhere.
 *
 * Commission and the KYC gate change here too, and both are audited with before/after values:
 * moving a category from 8% to 12% is a decision a seller can be asked to appeal.
 */
export const PATCH = withRoute<{ id: string }>(
  async (request: Request, context: RouteContext<{ id: string }>) => {
    const admin = await requireAdmin();
    const { id } = paramsSchema.parse(context.params);
    const patch = await readJson(request, adminCategoryPatchSchema);

    return jsonBody(await updateCategory(id, patch, admin.id), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
