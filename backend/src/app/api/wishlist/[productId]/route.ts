import { z } from 'zod';
import { withRoute, jsonBody, privateCache, RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { removeFromWishlist } from '@/lib/services/wishlist';

const paramsSchema = z.object({ productId: z.string().min(1).max(64) });

/**
 * `DELETE /api/wishlist/{productId}`
 *
 * Removing a saved item that is not there returns the same shape as one that was: the client
 * already wanted this outcome, and a 404 on an unheart tap just makes the button flicker back.
 */
export const DELETE = withRoute<{ productId: string }>(
  async (_request: Request, context: RouteContext<{ productId: string }>) => {
    const user = await requireUser();
    const { productId } = paramsSchema.parse(context.params);

    return jsonBody(await removeFromWishlist(user.id, productId), 200, privateCache());
  },
);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
