import { z } from 'zod';
import { withRoute, jsonBody, privateCache, type RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { loadOrderGroup } from '@/lib/services/orders';

const paramsSchema = z.object({ groupId: z.string().min(1).max(64) });

/**
 * `GET /api/orders/group/[groupId]`
 *
 * The page the buyer lands on after the MoMo prompt: one payment, the shops it paid, and the
 * order numbers to quote to support. Ownership is the group's own `userId`, so a caller who
 * guesses another buyer's id gets a 403 — and an admin can open it for a dispute.
 */
export const GET = withRoute<{ groupId: string }>(async (
  _request: Request,
  context: RouteContext<{ groupId: string }>,
) => {
  const user = await requireUser();
  const { groupId } = paramsSchema.parse(context.params);
  return jsonBody(await loadOrderGroup(groupId, user), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
