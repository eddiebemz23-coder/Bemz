import { z } from 'zod';
import { withRoute, readJson, created, privateCache, type RouteContext } from '@/lib/http';
import { requireAdmin } from '@/lib/auth/guards';
import { getOrderDetail } from '@/lib/services/orders';
import { refundPayment } from '@/lib/payments';
import { refundSchema } from '@/lib/validation/commerce';
import { prisma } from '@/lib/prisma';

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

/**
 * `POST /api/orders/[id]/refund`
 *
 * Admin only, deliberately. A refund moves real money back out of the platform to a MoMo
 * wallet, and both sides of the transaction have an interest in pressing that button: a seller
 * who wants to close a complaint quickly and a buyer who wants their cash back. Handing it to
 * either of them would turn disputes into self-service accounting.
 *
 * What the service will not do is guess an amount — `refundPayment` refuses anything above
 * `amountPaidMinor - refundedMinor`, so repeated partial refunds cannot over-refund an order,
 * and an order that was never paid (cash on delivery, or a failed card charge) has nothing to
 * refund at all.
 *
 * The audit row is written in the same request: who refunded, how much, against which payment,
 * and why. That trail is what a reconciliation dispute with MTN or Stripe is settled from.
 */
export const POST = withRoute<{ id: string }>(async (request: Request, context: RouteContext<{ id: string }>) => {
  const admin = await requireAdmin();
  const { id } = paramsSchema.parse(context.params);
  const body = await readJson(request, refundSchema);

  const before = await prisma.order.findUniqueOrThrow({
    where: { id },
    select: { orderNumber: true, status: true, amountPaidMinor: true, refundedMinor: true, currency: true },
  });

  const refund = await refundPayment({ orderId: id, amountMinor: body.amountMinor, reason: body.reason, actorId: admin.id });

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'ORDER_REFUND',
      entity: 'ORDER',
      entityId: id,
      reason: body.reason,
      before: {
        orderNumber: before.orderNumber,
        status: before.status,
        amountPaidMinor: Number(before.amountPaidMinor),
        refundedMinor: Number(before.refundedMinor),
      },
      after: { refundId: refund.refundId, refundStatus: refund.status, amountMinor: body.amountMinor },
    },
  });

  const order = await getOrderDetail(id, admin);

  return created(
    {
      ...refund,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        currency: order.currency,
        amountPaidMinor: order.amountPaidMinor,
        refundedMinor: order.refundedMinor,
      },
    },
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
