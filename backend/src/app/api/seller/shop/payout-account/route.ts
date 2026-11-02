import { withRoute, readJson, jsonBody, privateCache, unprocessable } from '@/lib/http';
import { requireSellerShop } from '@/lib/auth/guards';
import { upsertPayoutAccount } from '@/lib/services/accounts';
import { payoutAccountSchema } from '@/lib/validation/catalog';
import { prisma } from '@/lib/prisma';

/**
 * `POST /api/seller/shop/payout-account`
 *
 * The number is stored exactly as normalised (MoMo in E.164, bank digits verbatim): a payout
 * sent to a mistyped number is money that leaves the platform and does not come back.
 *
 * Editing it clears `isVerified` and blocks withdrawals until support confirms the new
 * destination — the window in which a hijacked account would most like to change where its
 * money goes.
 */
export const POST = withRoute(async (request: Request) => {
  const { shop } = await requireSellerShop();
  const input = await readJson(request, payoutAccountSchema);

  const pending = await prisma.payout.count({
    where: { shopId: shop.id, status: { in: ['REQUESTED', 'APPROVED'] } },
  });
  if (pending > 0) {
    throw unprocessable(
      `Withdraw or wait for your ${pending} pending payout request${pending === 1 ? '' : 's'} before changing the payout number`,
    );
  }

  return jsonBody(await upsertPayoutAccount(shop.id, input), 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
