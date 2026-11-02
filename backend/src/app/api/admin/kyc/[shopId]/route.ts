import { z } from 'zod';
import { withRoute, readJson, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { decideKyc, kycCase } from '@/lib/services/shops';
import { adminKycDecisionSchema } from '@/lib/validation/commerce';

const paramsSchema = z.object({ shopId: z.string().min(1).max(64) });

/**
 * `GET /api/admin/kyc/{shopId}`
 *
 * The documents with short-lived signed view URLs, plus the identity fields the reviewer is
 * matching them against. Admin-only: this is the one endpoint in the platform that shows an
 * ID number, because verifying it is the only reason one exists.
 */
export const GET = withRoute<{ shopId: string }>(
  async (_request: Request, context: RouteContext<{ shopId: string }>) => {
    await requireAdmin();
    const { shopId } = paramsSchema.parse(context.params);

    return jsonBody(await kycCase(shopId), 200, privateCache());
  },
);

/**
 * `POST /api/admin/kyc/{shopId}`
 *
 * Approve or reject the named documents. The shop-level KYC status is the union of its
 * documents — any rejection sends the whole batch back — and only the last approval, on a shop
 * that is still `PENDING`, opens the stall. A seller cannot go live by uploading; a person has
 * to say yes.
 *
 * Rejecting without a note is allowed but useless to the seller, so the reviewer is asked for
 * one and it is carried into their notification.
 */
export const POST = withRoute<{ shopId: string }>(
  async (request: Request, context: RouteContext<{ shopId: string }>) => {
    const admin = await requireAdmin();
    const { shopId } = paramsSchema.parse(context.params);
    const { documentIds, decision, note } = await readJson(request, adminKycDecisionSchema);

    return jsonBody(await decideKyc({ shopId, documentIds, decision, note, reviewerId: admin.id }), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
