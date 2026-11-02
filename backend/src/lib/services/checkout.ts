import 'server-only';
import { prisma, type CurrencyCode, type OrderStatus, type PaymentProvider, type Prisma, type ShippingAddress } from '../prisma';
import { badRequest, conflict, notFound, unprocessable } from '../http';
import { quoteBasket, type BasketQuote } from './pricing';
import { newOrderGroupReference, newOrderNumber, newTrackingNumber, paymentExternalIdForKey, withUniqueRetry } from '../ids';
import { currencyForRegion, tryNormalisePhone } from '../phone';
import { env } from '../env';
import { sendSms } from '../sms';
import { initiatePayment } from '../payments';
import { COD_TTL_MS, PAYMENT_TTL_MS, buildOrderSnapshot } from './orders-shared';

/**
 * Checkout: one basket in, N orders out.
 *
 * A Bemz basket usually spans several shops (a phone from Electro Hub in Kampala, a suit
 * from a second-hand seller in Nairobi), and each shop packs, invoices and delivers its own
 * parcel. So the basket is quoted once and then split: an `OrderGroup` is what the buyer
 * paid, each `Order` is what one seller sees in their queue.
 *
 * Stock is RESERVED here, not sold. `reservedQuantity` is raised with a conditional update
 * so two buyers racing for the last unit cannot both pass, and the seller's on-hand
 * `stockQuantity` only drops when the parcel is packed.
 *
 * Payments follow the rail: mobile money and card take ONE charge for the whole group, so a
 * single `Payment` row is created; cash-on-delivery collects per parcel, so each order gets
 * its own row.
 */

export type CheckoutInput = {
  userId: string;
  cartId: string;
  address: ShippingAddress;
  deliveryDistrictId: number;
  fulfilmentType: 'SELLER_DELIVERY' | 'BUYER_PICKUP';
  paymentProvider: PaymentProvider;
  payerPhone?: string | null;
  couponCode?: string | null;
  buyerNote?: string | null;
  idempotencyKey: string;
};

export type CreatedOrder = {
  id: string;
  orderNumber: string;
  shopId: string;
  shopName: string;
  status: OrderStatus;
  subtotalMinor: number;
  discountMinor: number;
  shippingFeeMinor: number;
  taxMinor: number;
  platformFeeMinor: number;
  totalMinor: number;
  itemCount: number;
  trackingNumber: string;
  expiresAt: Date;
};

export type CheckoutResult = {
  groupId: string;
  groupReference: string;
  currency: CurrencyCode;
  totalMinor: number;
  orders: CreatedOrder[];
  payments: { id: string; externalId: string; provider: PaymentProvider; status: string; amountMinor: number }[];
  instruction: string;
  redirectUrl: string | null;
  replayed: boolean;
};

/** MTN caps `externalRef` at 20 characters, so the key is hashed rather than echoed. */
const externalIdForAttempt = (idempotencyKey: string, index: number) =>
  index === 0 ? paymentExternalIdForKey(idempotencyKey) : paymentExternalIdForKey(`${idempotencyKey}:${index}`);

function assertProviderMatchesMarket(params: {
  provider: PaymentProvider;
  currency: CurrencyCode;
  payerPhone?: string | null;
  cashOnDeliveryAllowed: boolean;
}) {
  if (params.provider === 'CASH_ON_DELIVERY' && !params.cashOnDeliveryAllowed) {
    throw unprocessable('Cash on delivery is not available in this delivery zone — pay with mobile money');
  }
  if (params.provider === 'MTN_MOMO' && params.currency !== 'UGX') {
    throw unprocessable('MTN Mobile Money only collects Ugandan shilling payments');
  }
  if (params.provider === 'STRIPE_CARD' && !env().STRIPE_SECRET_KEY && env().NODE_ENV === 'production') {
    throw unprocessable('Card payments are not enabled yet');
  }
  if (params.payerPhone) {
    const parsed = tryNormalisePhone(params.payerPhone, params.currency === 'UGX' ? 'UG' : 'KE');
    if (!parsed.ok) throw unprocessable(parsed.message);
    if (currencyForRegion(parsed.phone.region) !== params.currency) {
      throw unprocessable(`A ${parsed.phone.region} phone number cannot pay for ${params.currency} items`);
    }
  }
}

/**
 * Splits a basket discount across its lines by value, giving the rounding remainder to the
 * biggest line, so `sum(line.discountMinor) === basket.discountMinor` to the last unit.
 */
function allocateDiscount(lineTotals: number[], discountMinor: number): number[] {
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);
  if (subtotal <= 0 || discountMinor <= 0) return lineTotals.map(() => 0);

  const shares = lineTotals.map((total) => Math.floor((discountMinor * total) / subtotal));
  let remainder = discountMinor - shares.reduce((sum, value) => sum + value, 0);
  const bySize = [...shares.keys()].sort((a, b) => lineTotals[b]! - lineTotals[a]!);
  for (const index of bySize) {
    if (remainder <= 0) break;
    shares[index] = (shares[index] ?? 0) + 1;
    remainder -= 1;
  }
  return shares;
}

async function reserveStock(tx: Prisma.TransactionClient, lines: { variantId: string; quantity: number }[]) {
  for (const line of lines) {
    const updated = await tx.$executeRaw`
      UPDATE product_variants
         SET "reservedQuantity" = "reservedQuantity" + ${line.quantity}, "updatedAt" = now()
       WHERE id = ${line.variantId}
         AND "isDisabled" = false
         AND "deletedAt" IS NULL
         AND "stockQuantity" - "reservedQuantity" >= ${line.quantity}
    `;
    if (updated !== 1) {
      throw conflict(`Stock for one of your items changed while you were checking out — adjust the quantity and try again`);
    }
  }
}

/** A replayed checkout returns the original orders instead of charging a second time. */
async function findReplay(externalId: string): Promise<CheckoutResult | null> {
  const anchor = await prisma.payment.findUnique({
    where: { externalId },
    include: { order: { include: { group: { include: { orders: { include: { items: true, shop: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } } } } } },
  });
  const group = anchor?.order?.group;
  if (!group) return null;

  const payments = await prisma.payment.findMany({
    where: { orderId: { in: group.orders.map((order) => order.id) } },
    orderBy: { createdAt: 'asc' },
  });

  return {
    groupId: group.id,
    groupReference: group.reference,
    currency: group.currency,
    totalMinor: Number(group.totalMinor),
    orders: group.orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      shopId: order.shopId,
      shopName: order.shop.name,
      status: order.status,
      subtotalMinor: Number(order.subtotalMinor),
      discountMinor: Number(order.discountMinor),
      shippingFeeMinor: Number(order.shippingFeeMinor),
      taxMinor: Number(order.taxMinor),
      platformFeeMinor: Number(order.platformFeeMinor),
      totalMinor: Number(order.totalMinor),
      itemCount: order.items?.length ?? 0,
      trackingNumber: order.trackingNumber ?? newTrackingNumber(),
      expiresAt: order.expiresAt ?? new Date(),
    })),
    payments: payments.map((payment) => ({
      id: payment.id,
      externalId: payment.externalId,
      provider: payment.provider,
      status: payment.status,
      amountMinor: Number(payment.amountMinor),
    })),
    instruction: payments.some((payment) => payment.status === 'SUCCEEDED')
      ? 'This order is already paid for.'
      : 'A payment for this checkout is already in progress — check your phone.',
    redirectUrl: null,
    replayed: true,
  };
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const cart = await prisma.cart.findUnique({
    where: { id: input.cartId },
    include: { items: { where: { selected: true } } },
  });
  if (!cart || cart.userId !== input.userId || cart.status !== 'ACTIVE') {
    throw notFound('Your basket is no longer open — refresh the page');
  }

  const lines = cart.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
  if (lines.length === 0) throw badRequest('Select at least one item to check out');

  const replay = await findReplay(externalIdForAttempt(input.idempotencyKey, 0));
  if (replay) return replay;

  const quote: BasketQuote = await quoteBasket({
    lines,
    districtId: input.deliveryDistrictId,
    couponCode: input.couponCode,
    userId: input.userId,
    allowCashOnDelivery: env().COD_ENABLED,
  });

  assertProviderMatchesMarket({
    provider: input.paymentProvider,
    currency: quote.currency,
    payerPhone: input.payerPhone,
    cashOnDeliveryAllowed: quote.baskets.every((basket) => basket.cashOnDeliveryAllowed),
  });

  const cashOnDelivery = input.paymentProvider === 'CASH_ON_DELIVERY';
  const initialStatus: OrderStatus = cashOnDelivery ? 'AWAITING_CONFIRMATION' : 'AWAITING_PAYMENT';
  const ttl = cashOnDelivery ? COD_TTL_MS : PAYMENT_TTL_MS;
  const countryCode = quote.currency === 'UGX' ? 'UG' : 'KE';

  const coupon = quote.couponCode ? await prisma.coupon.findUnique({ where: { code: quote.couponCode }, select: { id: true, usedCount: true } }) : null;
  const buyer = await prisma.user.findUniqueOrThrow({ where: { id: input.userId }, select: { id: true, name: true, phone: true } });

  const created = await withUniqueRetry(async () => {
    const orderNumbers = quote.baskets.map(() => newOrderNumber(countryCode));

    return prisma.$transaction(async (tx) => {
      await reserveStock(
        tx,
        quote.baskets.flatMap((basket) => basket.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity }))),
      );

      const group = await tx.orderGroup.create({
        data: { reference: newOrderGroupReference(), userId: input.userId, currency: quote.currency, totalMinor: BigInt(quote.totalMinor) },
      });

      const orders: CreatedOrder[] = [];

      for (const [index, basket] of quote.baskets.entries()) {
        const platformFeeMinor = basket.lines.reduce((sum, line) => sum + line.commissionMinor, 0);
        const discounts = allocateDiscount(basket.lines.map((line) => line.lineTotalMinor), basket.discountMinor);
        const expiresAt = new Date(Date.now() + ttl);
        const trackingNumber = newTrackingNumber();

        const order = await tx.order.create({
          data: {
            orderNumber: orderNumbers[index]!,
            groupId: group.id,
            buyerId: input.userId,
            shopId: basket.shopId,
            status: initialStatus,
            currency: basket.currency,
            subtotalMinor: BigInt(basket.subtotalMinor),
            discountMinor: BigInt(basket.discountMinor),
            shippingFeeMinor: BigInt(basket.shippingFeeMinor),
            taxMinor: BigInt(basket.vatIncludedMinor),
            platformFeeMinor: BigInt(platformFeeMinor),
            totalMinor: BigInt(basket.totalMinor),
            amountPaidMinor: 0n,
            shippingAddressSnapshot: buildOrderSnapshot({
              address: input.address,
              districtName: quote.districtName,
              zoneCode: quote.zone.code,
              zoneName: basket.zoneName,
            }),
            districtId: quote.districtId,
            deliveryZoneId: basket.zoneId,
            recipientName: input.address.recipientName,
            recipientPhone: input.address.recipientPhone,
            deliveryNote: input.buyerNote ?? input.address.deliveryNote,
            buyerNote: input.buyerNote,
            fulfilmentType: input.fulfilmentType,
            trackingNumber,
            couponId: coupon?.id ?? null,
            placedAt: new Date(),
            expiresAt,
            items: {
              create: basket.lines.map((line, lineIndex) => ({
                variantId: line.variantId,
                productId: line.productId,
                productTitle: line.productTitle,
                variantName: line.variantName,
                sku: line.sku,
                shopName: line.shopName,
                imageUrl: line.imageUrl,
                unitPriceMinor: line.unitPriceMinor,
                currency: line.currency,
                quantity: line.quantity,
                discountMinor: discounts[lineIndex] ?? 0,
                commissionMinor: line.commissionMinor,
                totalMinor: line.lineTotalMinor - (discounts[lineIndex] ?? 0),
              })),
            },
            statusHistory: { create: { from: null, to: initialStatus, note: 'Order placed' } },
          },
          select: { id: true, orderNumber: true, shopId: true, status: true },
        });

        orders.push({
          id: order.id,
          orderNumber: order.orderNumber,
          shopId: order.shopId,
          shopName: basket.shopName,
          status: order.status,
          subtotalMinor: basket.subtotalMinor,
          discountMinor: basket.discountMinor,
          shippingFeeMinor: basket.shippingFeeMinor,
          taxMinor: basket.vatIncludedMinor,
          platformFeeMinor,
          totalMinor: basket.totalMinor,
          itemCount: basket.lines.length,
          trackingNumber,
          expiresAt,
        });
      }

      // One coupon per order group: `CouponRedemption.orderId` is unique, so it is attached
      // to the order that actually received the discount.
      if (coupon && quote.discountMinor > 0) {
        const discounted = orders.reduce((best, candidate) => (candidate.discountMinor > best.discountMinor ? candidate : best), orders[0]!);
        await tx.couponRedemption.create({
          data: { couponId: coupon.id, userId: input.userId, orderId: discounted.id, discountMinor: quote.discountMinor, currency: quote.currency },
        });
        await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: coupon.usedCount + 1 } });
      }

      await tx.cart.update({
        where: { id: cart.id },
        data: { status: 'CONVERTED', couponId: null, itemsCount: 0, subtotalMinor: 0 },
      });

      const paymentTargets = cashOnDelivery ? orders : orders.slice(0, 1);
      const payments = await Promise.all(
        paymentTargets.map((order, paymentIndex) =>
          tx.payment.create({
            data: {
              orderId: order.id,
              purpose: 'ORDER',
              provider: input.paymentProvider,
              status: 'INITIATED',
              amountMinor: BigInt(order.totalMinor),
              currency: quote.currency,
              payerPhone: input.payerPhone ?? buyer.phone,
              payerName: buyer.name,
              externalId: cashOnDelivery ? externalIdForAttempt(input.idempotencyKey, paymentIndex) : externalIdForAttempt(input.idempotencyKey, 0),
              requestedAt: new Date(),
              expiresAt: cashOnDelivery ? null : new Date(Date.now() + PAYMENT_TTL_MS),
            },
            select: { id: true, externalId: true, provider: true, status: true, amountMinor: true },
          }),
        ),
      );

      return { group, orders, payments };
    });
  });

  let instruction = cashOnDelivery
    ? 'Keep the exact amount ready — the rider confirms the cash on arrival.'
    : 'Complete the payment prompt on your phone.';
  let redirectUrl: string | null = null;
  const payments = created.payments.map((payment) => ({
    id: payment.id,
    externalId: payment.externalId,
    provider: payment.provider,
    status: payment.status as string,
    amountMinor: Number(payment.amountMinor),
  }));

  // Orders and reservations are already committed, so a dead payment network cannot leave
  // the buyer with nothing to show support.
  if (!cashOnDelivery) {
    try {
      const initiated = await initiatePayment(created.payments[0]!.id);
      instruction = initiated.instruction;
      redirectUrl = initiated.redirectUrl;
      payments[0] = { ...payments[0]!, status: initiated.payment.status };
    } catch (error) {
      console.error('[checkout] payment initiation failed', error);
      instruction = 'We could not reach the payment network. Your order is saved — retry the payment from your orders page.';
    }
  }

  const firstOrder = created.orders[0]!;
  try {
    await sendSms({
      to: buyer.phone ?? input.address.recipientPhone,
      userId: input.userId,
      template: 'order_placed',
      message: `Bemz: order ${firstOrder.orderNumber} received (${(quote.totalMinor / 100).toLocaleString()} ${quote.currency}, ref ${created.group.reference}). ${instruction}`,
    });
  } catch (error) {
    console.warn('[checkout] receipt SMS failed', error);
  }

  return {
    groupId: created.group.id,
    groupReference: created.group.reference,
    currency: quote.currency,
    totalMinor: quote.totalMinor,
    orders: created.orders,
    payments,
    instruction,
    redirectUrl,
    replayed: false,
  };
}
