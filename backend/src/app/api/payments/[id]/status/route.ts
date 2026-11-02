import { z } from 'zod';
import { withRoute, jsonBody, privateCache, type RouteContext } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { loadPaymentForBuyer, paymentView, refreshPaymentStatus } from '@/lib/payments';
import { prisma } from '@/lib/prisma';

const paramsSchema = z.object({ id: z.string().min(8).max(64) });

/**
 * `GET /api/payments/[id]/status`
 *
 * The answer to "did my money go through?" When a callback never arrived, this asks the
 * operator directly and settles the order from that answer, so a buyer whose MTN webhook was
 * lost in transit is not stuck holding an unpaid order they paid for.
 *
 * Once a payment is terminal the stored state is returned untouched — re-polling a settled
 * charge cannot move an order backwards, and the operator's own query is only made while the
 * payment is still open.
 */
export const GET = withRoute<{ id: string }>(async (_request: Request, context: RouteContext<{ id: string }>) => {
  const user = await requireUser();
  const { id } = paramsSchema.parse(context.params);

  const owned = await loadPaymentForBuyer(id, user);
  const payment = await refreshPaymentStatus(owned.id);

  const order = owned.orderId
    ? await prisma.order.findUnique({
        where: { id: owned.orderId },
        select: { id: true, orderNumber: true, status: true, totalMinor: true, amountPaidMinor: true, expiresAt: true },
      })
    : null;

  return jsonBody(
    {
      payment: paymentView(payment),
      order: order && {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalMinor: Number(order.totalMinor),
        amountPaidMinor: Number(order.amountPaidMinor),
        expiresAt: order.expiresAt,
      },
      paid: payment.status === 'SUCCEEDED',
      settled: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'].includes(payment.status),
      canRetry: ['FAILED', 'EXPIRED', 'CANCELLED'].includes(payment.status),
      message:
        payment.status === 'SUCCEEDED'
          ? 'Payment received. The seller has been told to pack your parcel.'
          : payment.status === 'PENDING_CUSTOMER'
            ? 'Waiting for you to enter your PIN on the phone that received the prompt.'
            : payment.status === 'PROCESSING'
              ? 'The network is still working on it — check again in a moment.'
              : 'This payment did not go through.',
    },
    200,
    privateCache(),
  );
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
