import 'server-only';
import { prisma, type OrderStatus, type PaymentProvider, type PaymentStatus, type Prisma } from '../prisma';
import { badRequest, forbidden, notFound, unprocessable } from '../http';
import { formatMoney } from '../money';
import type { CurrencyCode } from '../money';
import { sendSms, orderDispatchedMessage } from '../sms';
import { assertOrderConfirmOtp, requestOtp } from '../otp';
import { maskPhone } from '../phone';
import { settlePaymentSuccess } from '../payments';
import { STALE_RESERVATION_MS } from './orders-shared';
import type { AuthenticatedUser } from '../auth/guards';

/**
 * The order lifecycle, and the only place allowed to move it.
 *
 *   AWAITING_PAYMENT ──paid──▶ AWAITING_CONFIRMATION ──buyer OTP / seller──▶ CONFIRMED
 *        │ unexpected                         │                              │
 *        ▼                                    ▼                              ▼
 *     CANCELLED ◀── buyer/seller can still stop it ──  PACKED ──▶ OUT_FOR_DELIVERY ──▶ DELIVERED
 *
 * Stock follows the same discipline: checkout raises `reservedQuantity`, packing converts
 * the reservation into a real deduction (`stockQuantity`) and writes the `SALE` movement,
 * and cancelling before packing simply drops the reservation back.
 */

const BUYER_CANCELLABLE: OrderStatus[] = ['AWAITING_PAYMENT', 'AWAITING_CONFIRMATION'];
const SELLER_CANCELLABLE: OrderStatus[] = ['AWAITING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED'];

/** `Pack` is the point of no return for stock; `deliver` is the point of COD collection. */
const ALLOWED_SELLER_TRANSITIONS: Record<string, OrderStatus[]> = {
  AWAITING_PAYMENT: [],
  AWAITING_CONFIRMATION: ['CONFIRMED'],
  CONFIRMED: ['PACKED'],
  PACKED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
  FAILED: [],
};

export type OrderSummary = {
  id: string;
  orderNumber: string;
  groupId: string | null;
  status: OrderStatus;
  currency: CurrencyCode;
  subtotalMinor: number;
  discountMinor: number;
  shippingFeeMinor: number;
  taxMinor: number;
  platformFeeMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  refundedMinor: number;
  shopId: string;
  shopName: string;
  shopSlug: string;
  buyerId: string;
  buyerName: string | null;
  buyerPhone: string | null;
  itemCount: number;
  placedAt: Date;
  expiresAt: Date | null;
  trackingNumber: string | null;
  courierName: string | null;
  shipmentStatus: string;
  districtName: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  paymentStatus: PaymentStatus | null;
  paymentProvider: PaymentProvider | null;
};

export type OrderDetail = OrderSummary & {
  items: {
    id: string;
    variantId: string;
    productId: string;
    /** `null` once the listing is deleted — the order keeps its snapshot but there is nothing left to rate. */
    productSlug: string | null;
    productTitle: string;
    variantName: string;
    sku: string;
    imageUrl: string | null;
    unitPriceMinor: number;
    quantity: number;
    discountMinor: number;
    commissionMinor: number;
    totalMinor: number;
    deliveredQuantity: number;
    returnedQuantity: number;
  }[];
  address: Prisma.JsonValue;
  statusHistory: { id: string; from: string | null; to: string; note: string | null; createdAt: Date }[];
  payments: { id: string; provider: PaymentProvider; status: PaymentStatus; amountMinor: number; externalId: string; payerPhone: string | null; completedAt: Date | null }[];
  refunds: { id: string; amountMinor: number; status: string; reason: string | null; createdAt: Date }[];
  deliveryNote: string | null;
  buyerNote: string | null;
  sellerNote: string | null;
  cancellationReason: string | null;
  estimatedDeliveryAt: Date | null;
  canBuyerCancel: boolean;
  canBuyerConfirm: boolean;
  canReview: boolean;
  allowedSellerTransitions: OrderStatus[];
};

const minor = (value: bigint | number): number => Number(value);

function toSummary(order: {
  id: string;
  orderNumber: string;
  groupId: string | null;
  status: OrderStatus;
  currency: CurrencyCode;
  subtotalMinor: bigint;
  discountMinor: bigint;
  shippingFeeMinor: bigint;
  taxMinor: bigint;
  platformFeeMinor: bigint;
  totalMinor: bigint;
  amountPaidMinor: bigint;
  refundedMinor: bigint;
  shopId: string;
  placedAt: Date;
  expiresAt: Date | null;
  trackingNumber: string | null;
  courierName: string | null;
  shipmentStatus: string;
  districtId: number | null;
  recipientName: string | null;
  recipientPhone: string | null;
  buyerId: string;
  buyer: { id: string; name: string | null; phone: string | null };
  shop: { name: string; slug: string };
  items: unknown[];
  district?: { name: string } | null;
  payments?: { status: PaymentStatus; provider: PaymentProvider }[];
}): OrderSummary {
  const payment = order.payments?.[0] ?? null;
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    groupId: order.groupId,
    status: order.status,
    currency: order.currency,
    subtotalMinor: minor(order.subtotalMinor),
    discountMinor: minor(order.discountMinor),
    shippingFeeMinor: minor(order.shippingFeeMinor),
    taxMinor: minor(order.taxMinor),
    platformFeeMinor: minor(order.platformFeeMinor),
    totalMinor: minor(order.totalMinor),
    amountPaidMinor: minor(order.amountPaidMinor),
    refundedMinor: minor(order.refundedMinor),
    shopId: order.shopId,
    shopName: order.shop.name,
    shopSlug: order.shop.slug,
    buyerId: order.buyer.id,
    buyerName: order.buyer.name,
    buyerPhone: order.buyer.phone,
    itemCount: order.items.length,
    placedAt: order.placedAt,
    expiresAt: order.expiresAt,
    trackingNumber: order.trackingNumber,
    courierName: order.courierName,
    shipmentStatus: order.shipmentStatus,
    districtName: order.district?.name ?? null,
    recipientName: order.recipientName,
    recipientPhone: order.recipientPhone,
    paymentStatus: payment?.status ?? null,
    paymentProvider: payment?.provider ?? null,
  };
}

const listInclude = {
  buyer: { select: { id: true, name: true, phone: true } },
  shop: { select: { name: true, slug: true } },
  district: { select: { name: true } },
  items: { select: { id: true } },
  payments: { select: { status: true, provider: true }, orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.OrderInclude;

export async function listOrders(user: AuthenticatedUser, params: {
  status?: OrderStatus;
  shipmentStatus?: string;
  shopId?: string | null;
  q?: string | null;
  from?: string;
  to?: string;
  page: number;
  perPage: number;
}): Promise<{ orders: OrderSummary[]; total: number; page: number; perPage: number }> {
  const where: Prisma.OrderWhereInput = {};

  if (user.role === 'ADMIN') {
    if (params.shopId) where.shopId = params.shopId;
  } else if (user.role === 'SELLER') {
    // A seller can only ever read their own queue, even if they pass someone else's shopId.
    const shops = await prisma.shop.findMany({ where: { ownerId: user.id }, select: { id: true } });
    if (shops.length === 0) return { orders: [], total: 0, page: params.page, perPage: params.perPage };
    where.shopId = params.shopId ? assertOwnShop(shops.map((shop) => shop.id), params.shopId) : { in: shops.map((shop) => shop.id) };
  } else {
    where.buyerId = user.id;
  }

  if (params.status) where.status = params.status;
  if (params.shipmentStatus) where.shipmentStatus = params.shipmentStatus as never;
  if (params.from || params.to) {
    where.placedAt = {
      ...(params.from ? { gte: new Date(params.from) } : {}),
      ...(params.to ? { lte: new Date(params.to) } : {}),
    };
  }
  if (params.q) {
    where.OR = [
      { orderNumber: { contains: params.q, mode: 'insensitive' } },
      { trackingNumber: { contains: params.q, mode: 'insensitive' } },
      { recipientPhone: { contains: params.q } },
    ];
  }

  const [total, rows] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: listInclude,
      orderBy: { placedAt: 'desc' },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
    }),
  ]);

  return { orders: rows.map((order) => toSummary(order)), total, page: params.page, perPage: params.perPage };
}

function assertOwnShop(ownedShopIds: string[], requested: string): string {
  if (!ownedShopIds.includes(requested)) throw forbidden('That shop is not yours');
  return requested;
}

const detailInclude = {
  // The variant's product slug is here so a delivered item can be rated: the review endpoint is
  // addressed by `/product/{shopSlug}/{productSlug}/reviews`, and an order snapshot has no slugs.
  items: { include: { variant: { select: { product: { select: { slug: true, deletedAt: true } } } } } },
  payments: { orderBy: { createdAt: 'desc' as const } },
  refunds: { orderBy: { createdAt: 'desc' as const } },
  statusHistory: { orderBy: { createdAt: 'asc' as const } },
  reviews: { select: { id: true } },
  shop: { select: { id: true, name: true, slug: true, ownerId: true } },
  district: { select: { name: true } },
  buyer: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.OrderInclude;

type AuthorisedOrder = Prisma.OrderGetPayload<{ include: typeof detailInclude }>;

/** Loads an order and proves the caller may see it. */
async function loadAuthorisedOrder(orderId: string, user: AuthenticatedUser): Promise<AuthorisedOrder> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: detailInclude });
  if (!order) throw notFound('Order not found');

  const maySee = order.buyerId === user.id || order.shop.ownerId === user.id || user.role === 'ADMIN';
  if (!maySee) throw forbidden('This order is not yours');

  return order;
}

export async function getOrderDetail(orderId: string, user: AuthenticatedUser): Promise<OrderDetail> {
  const order = await loadAuthorisedOrder(orderId, user);
  const summary = toSummary(order);
  const isBuyer = order.buyerId === user.id;
  const isSeller = order.shop.ownerId === user.id || user.role === 'ADMIN';

  return {
    ...summary,
    items: order.items.map((item) => ({
      id: item.id,
      variantId: item.variantId,
      productId: item.productId,
      productSlug: item.variant.product.deletedAt ? null : item.variant.product.slug,
      productTitle: item.productTitle,
      variantName: item.variantName,
      sku: item.sku,
      imageUrl: item.imageUrl,
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
      discountMinor: item.discountMinor,
      commissionMinor: item.commissionMinor,
      totalMinor: item.totalMinor,
      deliveredQuantity: item.deliveredQuantity,
      returnedQuantity: item.returnedQuantity,
    })),
    address: order.shippingAddressSnapshot,
    statusHistory: order.statusHistory.map((event) => ({
      id: event.id,
      from: event.from,
      to: event.to,
      note: event.note,
      createdAt: event.createdAt,
    })),
    payments: order.payments.map((payment) => ({
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      amountMinor: Number(payment.amountMinor),
      externalId: payment.externalId,
      payerPhone: payment.payerPhone,
      completedAt: payment.completedAt,
    })),
    refunds: order.refunds.map((refund) => ({
      id: refund.id,
      amountMinor: Number(refund.amountMinor),
      status: refund.status,
      reason: refund.reason,
      createdAt: refund.createdAt,
    })),
    deliveryNote: order.deliveryNote,
    buyerNote: order.buyerNote,
    sellerNote: order.sellerNote,
    cancellationReason: order.cancellationReason,
    estimatedDeliveryAt: order.estimatedDeliveryAt,
    canBuyerCancel: isBuyer && BUYER_CANCELLABLE.includes(order.status),
    canBuyerConfirm: isBuyer && order.status === 'AWAITING_CONFIRMATION',
    canReview: isBuyer && order.status === 'DELIVERED' && !order.reviews?.length,
    allowedSellerTransitions: isSeller ? (ALLOWED_SELLER_TRANSITIONS[order.status] ?? []) : [],
  };
}

/**
 * The buyer's receipt view: everything one payment covered.
 *
 * A basket spanning three shops becomes three orders, so after the payment prompt the app holds
 * one id — the group — and needs the parcels, their shops and the money split in a single read.
 * `totalMinor` is the group total, which is what was charged; the per-order totals are the
 * accounting breakdown, and they only sum to it when one payment covered the whole basket.
 */
export async function loadOrderGroup(groupId: string, user: AuthenticatedUser) {
  const group = await prisma.orderGroup.findUnique({
    where: { id: groupId },
    include: {
      orders: {
        include: {
          shop: { select: { id: true, name: true, slug: true } },
          items: {
            select: {
              id: true,
              productTitle: true,
              variantName: true,
              imageUrl: true,
              quantity: true,
              totalMinor: true,
            },
          },
          payments: { select: { id: true, provider: true, status: true, amountMinor: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!group) throw notFound('That order group no longer exists');
  if (group.userId !== user.id && user.role !== 'ADMIN') throw forbidden('Those orders are not yours');

  return {
    id: group.id,
    reference: group.reference,
    currency: group.currency,
    totalMinor: Number(group.totalMinor),
    createdAt: group.createdAt,
    orders: group.orders.map((order) => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      shop: order.shop,
      subtotalMinor: Number(order.subtotalMinor),
      discountMinor: Number(order.discountMinor),
      shippingFeeMinor: Number(order.shippingFeeMinor),
      totalMinor: Number(order.totalMinor),
      trackingNumber: order.trackingNumber,
      expiresAt: order.expiresAt,
      itemCount: order.items.length,
      items: order.items.map((item) => ({
        id: item.id,
        productTitle: item.productTitle,
        variantName: item.variantName,
        imageUrl: item.imageUrl,
        quantity: item.quantity,
        totalMinor: item.totalMinor,
      })),
      payments: order.payments.map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        status: payment.status,
        amountMinor: Number(payment.amountMinor),
      })),
    })),
  };
}

/** Both COD endpoints act on the same row, so both resolve and vet it the same way. */
async function loadConfirmableOrder(orderId: string, user: AuthenticatedUser) {
  const order = await loadAuthorisedOrder(orderId, user);
  if (order.buyerId !== user.id) throw forbidden('Only the buyer can confirm this order');
  if (order.status !== 'AWAITING_CONFIRMATION') {
    throw unprocessable(`This order is already ${order.status.toLowerCase().replace(/_/g, ' ')}`);
  }
  const phone = order.recipientPhone ?? order.buyer.phone;
  if (!phone) throw badRequest('This order has no phone number to confirm');
  return { order, phone };
}

/**
 * The buyer never posts the number to send to — it is read off the order, so a confirmation
 * code can only ever reach the handset the parcel was promised to.
 */
export async function requestOrderConfirmCode(orderId: string, user: AuthenticatedUser) {
  const { order, phone } = await loadConfirmableOrder(orderId, user);
  const result = await requestOtp({ phone, purpose: 'ORDER_CONFIRM', allowNewAccount: false });

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    sentTo: maskPhone(result.e164),
    expiresInSeconds: result.expiresInSeconds,
    cooldownSeconds: result.cooldownSeconds,
    devCode: result.devCode,
    message: 'Enter the 6-digit code to confirm the cash-on-delivery order.',
  };
}

/**
 * The buyer proves a COD order is real with an SMS code. Without this, anyone who can guess
 * a phone number could place orders against it — the reason Ugandan and Kenyan marketplaces
 * gate cash-on-delivery at all.
 */
export async function confirmOrderByOtp(params: { orderId: string; user: AuthenticatedUser; code: string }) {
  const { order, phone } = await loadConfirmableOrder(params.orderId, params.user);

  await assertOrderConfirmOtp({ phone, code: params.code });

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
      select: { id: true, orderNumber: true, status: true },
    });
    await tx.orderStatusEvent.create({
      data: { orderId: order.id, from: 'AWAITING_CONFIRMATION', to: 'CONFIRMED', note: 'Buyer confirmed by SMS code' },
    });
    return updated;
  });
}

/** Packing is where a reservation becomes a real sale. */
async function consumeStock(tx: Prisma.TransactionClient, order: { id: string; shopId: string; items: { variantId: string; quantity: number }[] }, actorId: string) {
  const byVariant = new Map<string, number>();
  for (const item of order.items) {
    byVariant.set(item.variantId, (byVariant.get(item.variantId) ?? 0) + item.quantity);
  }

  for (const [variantId, quantity] of byVariant) {
    const updated = await tx.$executeRaw`
      UPDATE product_variants
         SET "stockQuantity" = "stockQuantity" - ${quantity},
             "reservedQuantity" = GREATEST(0, "reservedQuantity" - ${quantity}),
             "updatedAt" = now()
       WHERE id = ${variantId}
         AND "stockQuantity" >= ${quantity}
    `;
    if (updated !== 1) {
      throw unprocessable(`Stock ledger says there are fewer than ${quantity} units left to pack — correct the stock count first`);
    }

    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQuantity: true, lowStockThreshold: true, product: { select: { title: true } } },
    });

    await tx.inventoryMovement.create({
      data: {
        variantId,
        shopId: order.shopId,
        reason: 'SALE',
        delta: -quantity,
        balanceAfter: variant.stockQuantity,
        orderId: order.id,
        actorId,
        note: `Packed for order ${order.id}`,
        idempotencyKey: `order:${order.id}:variant:${variantId}:sale`,
      },
    });

    if (variant.stockQuantity <= variant.lowStockThreshold) {
      await tx.notification.create({
        data: {
          userId: actorId,
          channel: 'IN_APP',
          template: 'low_stock',
          title: 'Running low',
          body: `${variant.product.title} is down to ${variant.stockQuantity} units.`,
          data: { variantId, orderId: order.id },
        },
      });
    }
  }
}

/** Drops a reservation that never became a sale. */
async function releaseReservation(tx: Prisma.TransactionClient, items: { variantId: string; quantity: number }[]) {
  const byVariant = new Map<string, number>();
  for (const item of items) byVariant.set(item.variantId, (byVariant.get(item.variantId) ?? 0) + item.quantity);
  for (const [variantId, quantity] of byVariant) {
    await tx.$executeRaw`
      UPDATE product_variants
         SET "reservedQuantity" = GREATEST(0, "reservedQuantity" - ${quantity}), "updatedAt" = now()
       WHERE id = ${variantId}
    `;
  }
}

/** Returns units to the shelf after a sale that had already been consumed. */
async function restockConsumed(tx: Prisma.TransactionClient, order: { id: string; shopId: string; items: { variantId: string; quantity: number; returnedQuantity: number }[] }, actorId: string, reason: string) {
  for (const item of order.items) {
    const quantity = item.quantity - item.returnedQuantity;
    if (quantity <= 0) continue;
    await tx.$executeRaw`
      UPDATE product_variants
         SET "stockQuantity" = "stockQuantity" + ${quantity}, "updatedAt" = now()
       WHERE id = ${item.variantId}
    `;
    const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: item.variantId }, select: { stockQuantity: true } });
    await tx.inventoryMovement.create({
      data: {
        variantId: item.variantId,
        shopId: order.shopId,
        reason: 'CANCELLATION_REVERSAL',
        delta: quantity,
        balanceAfter: variant.stockQuantity,
        orderId: order.id,
        actorId,
        note: reason.slice(0, 200),
        idempotencyKey: `order:${order.id}:variant:${item.variantId}:reversal`,
      },
    });
  }
}

export async function sellerTransition(params: {
  orderId: string;
  user: AuthenticatedUser;
  to: OrderStatus;
  note?: string | null;
  trackingNumber?: string | null;
  courierName?: string | null;
  consumedStock: boolean;
}): Promise<OrderDetail> {
  const order = await loadAuthorisedOrder(params.orderId, params.user);
  if (order.shop.ownerId !== params.user.id && params.user.role !== 'ADMIN') {
    throw forbidden('Only the seller of this parcel can update it');
  }

  const allowed = ALLOWED_SELLER_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(params.to)) {
    throw unprocessable(`An order that is ${order.status.toLowerCase().replace(/_/g, ' ')} cannot go straight to ${params.to.toLowerCase().replace(/_/g, ' ')}`);
  }
  if (params.to === 'OUT_FOR_DELIVERY' && !order.trackingNumber && !params.trackingNumber) {
    throw badRequest('Add the courier tracking number before dispatch');
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (params.to === 'PACKED' && params.consumedStock) {
      await consumeStock(tx, order, params.user.id);
    }

    const data: Prisma.OrderUpdateInput = { status: params.to };
    if (params.to === 'CONFIRMED') data.confirmedAt = now;
    if (params.to === 'PACKED') data.packedAt = now;
    if (params.to === 'OUT_FOR_DELIVERY') {
      data.shippedAt = now;
      data.shipmentStatus = 'OUT_FOR_DELIVERY';
      if (params.trackingNumber) data.trackingNumber = params.trackingNumber;
      if (params.courierName) data.courierName = params.courierName;
    }
    if (params.to === 'DELIVERED') {
      data.deliveredAt = now;
      data.shipmentStatus = 'DELIVERED';
      data.expiresAt = null;
    }
    if (params.note) data.sellerNote = params.note;

    await tx.order.update({ where: { id: order.id }, data });
    await tx.orderStatusEvent.create({
      data: { orderId: order.id, from: order.status, to: params.to, note: params.note ?? null, actorId: params.user.id },
    });

    // Sellers of multi-line parcels sometimes hand-deliver and tick the whole parcel in.
    if (params.to === 'DELIVERED') {
      for (const item of order.items) {
        await tx.orderItem.update({ where: { id: item.id }, data: { deliveredQuantity: item.quantity } });
      }
    }
  });

  // Cash is only proven to exist once the parcel is in the buyer's hands.
  if (params.to === 'DELIVERED') {
    const codPayment = await prisma.payment.findFirst({
      where: { orderId: order.id, provider: 'CASH_ON_DELIVERY', status: { in: ['INITIATED', 'PENDING_CUSTOMER', 'PROCESSING'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (codPayment) await settlePaymentSuccess(codPayment.id);
  }

  await notifyBuyer(order, params.to, params.note, params.trackingNumber ?? order.trackingNumber);

  return getOrderDetail(order.id, params.user);
}

export async function cancelOrder(params: {
  orderId: string;
  user: AuthenticatedUser;
  reason: string;
  restock: boolean;
}): Promise<OrderDetail> {
  const order = await loadAuthorisedOrder(params.orderId, params.user);
  const by = params.user.role === 'ADMIN' ? 'ADMIN' : order.buyerId === params.user.id ? 'BUYER' : 'SELLER';

  const cancellable = by === 'BUYER' ? BUYER_CANCELLABLE : SELLER_CANCELLABLE;
  if (!cancellable.includes(order.status) && by !== 'ADMIN') {
    throw unprocessable(`This order is ${order.status.toLowerCase().replace(/_/g, ' ')} and can no longer be cancelled — ask for a refund instead`);
  }
  if (['DELIVERED', 'REFUNDED', 'CANCELLED'].includes(order.status)) {
    throw unprocessable('This order is already closed');
  }

  const stockWasConsumed = ['PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(order.status);

  await prisma.$transaction(async (tx) => {
    if (stockWasConsumed && params.restock) {
      await restockConsumed(tx, order, params.user.id, params.reason);
    } else if (!stockWasConsumed) {
      await releaseReservation(tx, order.items);
    }

    await tx.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: by, cancellationReason: params.reason.slice(0, 300), expiresAt: null },
    });
    await tx.orderStatusEvent.create({
      data: { orderId: order.id, from: order.status, to: 'CANCELLED', note: `${by}: ${params.reason}`.slice(0, 300), actorId: params.user.id },
    });

    // A paid order being cancelled becomes a refund the operations queue must action; money
    // is never silently returned by a cancellation button.
    const paid = await tx.payment.findFirst({ where: { orderId: order.id, status: 'SUCCEEDED' }, select: { id: true, amountMinor: true } });
    if (paid && Number(paid.amountMinor) > 0) {
      await tx.refund.create({
        data: {
          paymentId: paid.id,
          orderId: order.id,
          amountMinor: paid.amountMinor,
          currency: order.currency,
          status: 'PENDING',
          reason: `Cancelled: ${params.reason}`.slice(0, 300),
          processedById: params.user.id,
        },
      });
    }

    const unpaid = await tx.payment.findMany({ where: { orderId: order.id, status: { in: ['INITIATED', 'PENDING_CUSTOMER', 'PROCESSING'] } }, select: { id: true } });
    if (unpaid.length > 0) {
      await tx.payment.updateMany({ where: { id: { in: unpaid.map((payment) => payment.id) } }, data: { status: 'CANCELLED', failureReason: 'Order cancelled' } });
    }
  });

  await notifyBuyer(order, 'CANCELLED', params.reason);
  return getOrderDetail(order.id, params.user);
}

async function notifyBuyer(
  order: { orderNumber: string; buyer: { phone: string | null; id: string } },
  to: OrderStatus,
  note?: string | null,
  trackingNumber?: string | null,
) {
  const phone = order.buyer.phone;
  if (!phone) return;
  const tracking = trackingNumber ?? null;
  try {
    if (to === 'OUT_FOR_DELIVERY' && tracking) {
      await sendSms({
        to: phone,
        userId: order.buyer.id,
        template: 'order_dispatched',
        message: orderDispatchedMessage({ orderNumber: order.orderNumber, trackingNumber: tracking }),
      });
    } else {
      await sendSms({
        to: phone,
        userId: order.buyer.id,
        template: `order_${to.toLowerCase()}`,
        message: `Bemz: order ${order.orderNumber} is now ${to.replace(/_/g, ' ').toLowerCase()}.${tracking ? ` Tracking ${tracking}.` : ''}${note ? ` Seller note: ${note}` : ''}`,
      });
    }
  } catch (error) {
    // A status change is already committed; an SMS failure must not roll it back.
    console.warn('[orders] buyer notification failed', error);
  }
}

/** Seller dashboard counters: the queue badges a seller acts on. */
export async function sellerOrderStats(shopId: string) {
  const grouped = await prisma.order.groupBy({
    by: ['status'],
    where: { shopId },
    _count: { _all: true },
    _sum: { totalMinor: true },
  });
  const statuses = Object.fromEntries(grouped.map((row) => [row.status, { count: row._count._all, totalMinor: Number(row._sum.totalMinor ?? 0n) }]));
  const grossSalesMinor = grouped
    .filter((row) => ['DELIVERED', 'OUT_FOR_DELIVERY', 'PACKED', 'CONFIRMED'].includes(row.status))
    .reduce((sum, row) => sum + Number(row._sum.totalMinor ?? 0n), 0);
  const commissionMinor = await prisma.orderItem.aggregate({
    where: { order: { shopId, status: 'DELIVERED' } },
    _sum: { commissionMinor: true },
  });
  return { statuses, grossSalesMinor, commissionMinor: Number(commissionMinor._sum.commissionMinor ?? 0n) };
}

/** Buyer-facing money strings are already locale-formatted by the client; this is for SMS/emails. */
export const orderTotalLabel = (order: Pick<OrderSummary, 'totalMinor' | 'currency'>) =>
  formatMoney(order.totalMinor, order.totalMinor > 0 ? (order.currency as never) : 'UGX');

/**
 * Releases stock pinned by abandoned checkouts.
 *
 * Called by the scheduled sweep, not on a timer inside a request: two workers running the
 * sweep is safe because every release is guarded by the order's own status.
 */
export async function expireStaleOrders(now = new Date()) {
  const stale = await prisma.order.findMany({
    where: {
      status: { in: ['AWAITING_PAYMENT', 'AWAITING_CONFIRMATION'] },
      expiresAt: { not: null, lt: now },
    },
    include: { items: { select: { variantId: true, quantity: true } } },
    take: 200,
    orderBy: { expiresAt: 'asc' },
  });

  let released = 0;
  for (const order of stale) {
    await prisma.$transaction(async (tx) => {
      await releaseReservation(tx, order.items);
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelledAt: now, cancelledBy: 'SYSTEM', cancellationReason: 'Payment was never completed', expiresAt: null } });
      await tx.orderStatusEvent.create({ data: { orderId: order.id, from: order.status, to: 'CANCELLED', note: 'Expired: payment window closed' } });
      await tx.payment.updateMany({
        where: { orderId: order.id, status: { in: ['INITIATED', 'PENDING_CUSTOMER', 'PROCESSING'] } },
        data: { status: 'EXPIRED', failureCode: 'EXPIRED', failureReason: 'Payment window closed' },
      });
    });
    released += 1;
  }

  // Safety net: reservations with no live order behind them at all.
  const pinned = await prisma.$executeRaw`
    UPDATE product_variants
       SET "reservedQuantity" = 0, "updatedAt" = now()
     WHERE "reservedQuantity" > 0
       AND "updatedAt" < now() - interval '30 days'
  `;

  return { expired: released, resetVariantReservations: pinned, staleBefore: new Date(now.getTime() - STALE_RESERVATION_MS) };
}
