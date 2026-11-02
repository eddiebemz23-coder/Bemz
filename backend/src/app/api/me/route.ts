import { withRoute, jsonBody, readJson, privateCache, unprocessable } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { loadMe, updateProfile } from '@/lib/services/accounts';
import { updateProfileSchema } from '@/lib/validation/auth';
import { prisma } from '@/lib/prisma';

/**
 * `GET /api/me`
 *
 * The app hydrates from here after sign-in: profile, market defaults, the seller's own
 * shops and the address the checkout form will pre-fill. Kept as one call so a phone on
 * 2G does not make six round trips to render a dashboard.
 */
export const GET = withRoute(async () => {
  const user = await requireUser();
  const me = await loadMe(user.id);
  return jsonBody(me, 200, privateCache());
});

/**
 * `PATCH /api/me`
 *
 * `preferredCurrency` is a display default only: prices are stored in the seller's
 * currency and converted at checkout, so changing it never rewrites anyone's totals.
 */
export const PATCH = withRoute(async (request: Request) => {
  const user = await requireUser();
  const patch = await readJson(request, updateProfileSchema);
  const updated = await updateProfile(user.id, patch);
  return jsonBody(updated, 200, privateCache());
});

/**
 * `DELETE /api/me` — close the account.
 *
 * We keep the row and mark it DELETED: an order that is still in delivery needs its
 * buyer, its address snapshot and its payment trail, and deleting those would strand a
 * rider holding cash. Personal columns are scrubbed first so the stored record is no
 * longer identifiable.
 */
export const DELETE = withRoute(async (request: Request) => {
  const user = await requireUser();

  const openOrders = await prisma.order.count({
    where: {
      buyerId: user.id,
      status: { in: ['AWAITING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY'] },
    },
  });
  if (openOrders > 0) {
    throw unprocessable(
      `You still have ${openOrders} order${openOrders === 1 ? '' : 's'} on the way — close the account after delivery or cancellation`,
    );
  }

  const liveShop = await prisma.shop.findFirst({
    where: { ownerId: user.id, deletedAt: null, status: { in: ['ACTIVE', 'PENDING'] } },
    select: { id: true, name: true },
  });
  if (liveShop) throw unprocessable(`Close "${liveShop.name}" first — its open listings and payouts must settle`);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      status: 'DELETED',
      deletedAt: new Date(),
      name: null,
      email: null,
      phone: `deleted:${user.id}`,
      passwordHash: null,
      avatarUrl: null,
      avatarPublicId: null,
      marketingOptIn: false,
      whatsappOptIn: false,
    },
  });

  return jsonBody({ closed: true });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
