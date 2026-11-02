import 'server-only';
import { Prisma, prisma, type AuditEntity, type CurrencyCode, type OrderStatus } from '../prisma';
import { conflict, notFound, unprocessable } from '../http';
import { env } from '../env';

/**
 * What the platform team does to other people's listings, shops and accounts.
 *
 * Every write here lands in `AuditLog` with a named actor and a reason, because a ban lifted
 * without a trace is the thing a seller escalates to social media. A JWT cannot be pulled back
 * mid-flight, so a banned account is cut off by `guards.ts` re-reading the user row on the
 * next guarded request — which is why the ban also flips `status` rather than deleting rows.
 */

/**
 * `POST /api/admin/products/[id]/moderate`
 *
 * Rejection keeps the listing: the seller needs to see what was refused and fix it, and a
 * deleted listing cannot be appealed.
 */
export async function moderateProduct(
  productId: string,
  params: { decision: 'APPROVE' | 'REJECT'; reason?: string; actorId: string },
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, title: true, slug: true, status: true, shopId: true, shop: { select: { ownerId: true, name: true, slug: true } } },
  });
  if (!product) throw notFound('Listing not found');
  if (product.status === 'ARCHIVED') throw conflict('The seller archived this listing — there is nothing to approve');

  const status = params.decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.product.update({
      where: { id: productId },
      data: {
        status,
        rejectionReason: status === 'REJECTED' ? params.reason ?? 'Does not meet our listing rules' : null,
        moderatedAt: new Date(),
        moderatedById: params.actorId,
        // Approved once, this listing no longer needs a first look on every edit. A listing that
        // is later rejected is sent back through the queue by the seller-side status check.
        ...(status === 'ACTIVE' ? { requiresModeration: false } : {}),
      },
      select: { id: true, status: true, title: true, slug: true, rejectionReason: true },
    });

    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        action: status === 'ACTIVE' ? 'PRODUCT_APPROVE' : 'PRODUCT_REJECT',
        entity: 'PRODUCT',
        entityId: productId,
        reason: params.reason,
        before: { status: product.status },
        after: { status },
      },
    });

    await tx.notification.create({
      data: {
        userId: product.shop.ownerId,
        channel: 'IN_APP',
        status: 'SENT',
        template: status === 'ACTIVE' ? 'product_approved' : 'product_rejected',
        title: status === 'ACTIVE' ? 'Your listing is live' : 'Listing needs a fix',
        body:
          status === 'ACTIVE'
            ? `${product.title} is now visible in ${product.shop.name}.`
            : params.reason ?? 'Edit the listing and submit it again.',
        data: { productId, slug: `/${product.shop.slug}/product/${product.slug}` },
        sentAt: new Date(),
      },
    });

    return row;
  });

  return updated;
}

/**
 * `PATCH /api/admin/shops/[shopId]`
 *
 * Suspension hides the stall from discovery but leaves every order readable — a buyer who
 * ordered a mattress last week must still be able to see what they bought and who sold it.
 */
export async function setShopStatusByAdmin(
  shopId: string,
  params: { status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED'; reason?: string; verified?: boolean; actorId: string },
) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { id: true, name: true, slug: true, status: true, ownerId: true, isVerified: true, kycStatus: true },
  });
  if (!shop) throw notFound('Shop not found');

  if (params.status === 'ACTIVE' && shop.kycStatus !== 'APPROVED') {
    throw unprocessable('Approve this seller’s ID documents before opening the shop');
  }

  const openOrders =
    params.status === 'CLOSED'
      ? await prisma.order.count({ where: { shopId, status: { in: ['CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION'] } } })
      : 0;
  if (params.status === 'CLOSED' && openOrders > 0) {
    throw conflict(`${openOrders} order${openOrders === 1 ? '' : 's'} still awaiting fulfilment`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.shop.update({
      where: { id: shopId },
      data: {
        status: params.status,
        // A suspended stall is not on holiday; clearing the flag stops a mixed signal.
        ...(params.status === 'SUSPENDED' ? { vacationMode: false } : {}),
        ...(params.verified !== undefined ? { isVerified: params.verified } : {}),
      },
      select: { id: true, name: true, slug: true, status: true, isVerified: true, vacationMode: true },
    });

    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.status === 'SUSPENDED' ? 'SHOP_SUSPEND' : 'SHOP_RESTORE',
        entity: 'SHOP',
        entityId: shopId,
        reason: params.reason,
        before: { status: shop.status, isVerified: shop.isVerified },
        after: { status: row.status, isVerified: row.isVerified },
      },
    });

    await tx.notification.create({
      data: {
        userId: shop.ownerId,
        channel: 'IN_APP',
        status: 'SENT',
        template: `shop_${params.status.toLowerCase()}`,
        title:
          params.status === 'SUSPENDED'
            ? 'Your shop is on hold'
            : params.status === 'CLOSED'
              ? 'Your shop is closed'
              : 'Your shop is open again',
        body: params.reason ?? 'The platform team updated your shop status.',
        data: { shopId },
        sentAt: new Date(),
      },
    });

    return row;
  });

  return updated;
}

/**
 * `PATCH /api/admin/users/[userId]`
 *
 * A ban is a status, never a delete: orders, payouts already sent and reviews must keep
 * pointing at a real person for the dispute trail.
 */
export async function setUserStatus(
  userId: string,
  params: { status: 'ACTIVE' | 'SUSPENDED' | 'BANNED'; reason?: string; actorId: string },
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, status: true, role: true },
  });
  if (!user) throw notFound('Account not found');
  // There is no role above ADMIN in this build, so an admin account cannot be restricted
  // through the API at all — that has to happen in the database with two people watching.
  if (user.role === 'ADMIN' && params.status !== 'ACTIVE') {
    throw unprocessable('An admin account cannot be suspended through the API');
  }

  const openOrders = await prisma.order.count({ where: { buyerId: userId, status: { in: ['AWAITING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY'] } } });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id: userId },
      data: { status: params.status },
      select: { id: true, name: true, role: true, status: true },
    });

    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        action: params.status === 'ACTIVE' ? 'USER_UNBAN' : 'USER_BAN',
        entity: 'USER',
        entityId: userId,
        reason: params.reason,
        before: { status: user.status },
        after: { status: params.status, openOrders },
      },
    });

    return row;
  });

  return { ...updated, openOrders };
}

/**
 * The support file on one account: who they are, what they sell, whether anything of theirs is
 * still moving, and the money trails a dispute would need.
 *
 * No password hash, no OTP rows, no session data — an admin screen that can read a credential
 * is a credential-leak surface with a nice UI.
 */
export async function adminUserCase(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      role: true,
      status: true,
      country: true,
      preferredCurrency: true,
      createdAt: true,
      lastLoginAt: true,
      shopsOwned: {
        select: { id: true, name: true, slug: true, status: true, kycStatus: true, ratingAvg: true, totalSalesCount: true },
      },
    },
  });
  if (!user) throw notFound('Account not found');

  const [asBuyer, openAsBuyer, asSeller, recentPayments] = await Promise.all([
    prisma.order.count({ where: { buyerId: userId } }),
    prisma.order.count({ where: { buyerId: userId, status: { in: ['CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY'] } } }),
    prisma.order.count({ where: { shop: { ownerId: userId } } }),
    prisma.payment.findMany({
      where: { order: { buyerId: userId } },
      select: { id: true, provider: true, status: true, amountMinor: true, currency: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  const { shopsOwned, ...account } = user;

  return {
    account,
    shops: shopsOwned.map((shop) => ({ ...shop, ratingAvg: shop.ratingAvg === null ? null : Number(shop.ratingAvg) })),
    orders: { placed: asBuyer, inFlight: openAsBuyer, soldAsSeller: asSeller },
    // `amountMinor` is a BigInt column and `NextResponse.json` cannot serialise one, so the
    // projection narrows it here like every other service view does.
    recentPayments: recentPayments.map((payment) => ({ ...payment, amountMinor: Number(payment.amountMinor) })),
  };
}

/** The three queues the platform team works through in the morning. */
export async function moderationQueues() {
  const [products, shops, kyc, reviews] = await Promise.all([
    prisma.product.findMany({
      where: { status: 'PENDING_REVIEW', deletedAt: null },
      select: {
        id: true,
        title: true,
        slug: true,
        startingPriceMinor: true,
        currency: true,
        createdAt: true,
        images: { where: { variantId: null }, orderBy: { position: 'asc' }, take: 1, select: { url: true } },
        shop: { select: { id: true, name: true, slug: true, kycStatus: true, totalSalesCount: true } },
        categories: { where: { isPrimary: true }, select: { category: { select: { name: true, requiresKyc: true } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    prisma.shop.findMany({
      where: { status: 'PENDING', deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        createdAt: true,
        kycStatus: true,
        country: { select: { code: true, name: true } },
        baseDistrict: { select: { name: true } },
        owner: { select: { id: true, name: true, phone: true, phoneVerified: true } },
        _count: { select: { products: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    prisma.kycDocument.findMany({
      where: { status: 'SUBMITTED' },
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
        expiresAt: true,
        shopId: true,
        shop: { select: { id: true, name: true, slug: true, nationalIdNumber: true, taxPin: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    prisma.review.count({ where: { status: 'PENDING' } }),
  ]);

  return {
    products: products.map((product) => ({
      ...product,
      imageUrl: product.images[0]?.url ?? null,
      primaryCategory: product.categories[0]?.category ?? null,
    })),
    shops,
    kycDocuments: kyc,
    pendingReviewCount: reviews,
  };
}

/**
 * `GET /api/admin/metrics`
 *
 * GMV counts money the buyer actually paid, so an unpaid basket never inflates the number in
 * a board deck. Commission is the platform fee on those same orders.
 */
export async function adminMetrics(days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const previousSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);

  // Money the platform actually holds: past payment, not cancelled or refunded.
  const paidStatuses: OrderStatus[] = ['CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'];

  const [current, previous, byStatus, newShops, newBuyers, rails, cancellations, refunds] = await Promise.all([
    prisma.order.aggregate({
      where: { placedAt: { gte: since }, status: { in: paidStatuses } },
      _sum: { totalMinor: true, platformFeeMinor: true, subtotalMinor: true, shippingFeeMinor: true, discountMinor: true },
      _count: { _all: true },
      _avg: { totalMinor: true },
    }),
    prisma.order.aggregate({
      where: { placedAt: { gte: previousSince, lt: since }, status: { in: paidStatuses } },
      _sum: { totalMinor: true, platformFeeMinor: true },
      _count: { _all: true },
    }),
    prisma.order.groupBy({ by: ['status'], where: { placedAt: { gte: since } }, _count: { _all: true } }),
    prisma.shop.count({ where: { createdAt: { gte: since } } }),
    prisma.user.count({ where: { createdAt: { gte: since }, role: 'BUYER' } }),
    prisma.payment.groupBy({
      by: ['provider'],
      where: { createdAt: { gte: since }, status: 'SUCCEEDED' },
      _count: { _all: true },
      _sum: { amountMinor: true },
    }),
    prisma.order.count({ where: { placedAt: { gte: since }, status: 'CANCELLED' } }),
    prisma.refund.aggregate({ where: { createdAt: { gte: since }, status: 'SUCCEEDED' }, _sum: { amountMinor: true }, _count: { _all: true } }),
  ]);

  const gmvMinor = Number(current._sum.totalMinor ?? 0n);
  const previousGmv = Number(previous._sum.totalMinor ?? 0n);

  // Currency is not stored on the metric; the dominant order currency is what the deck quotes.
  const dominant = await prisma.order.groupBy({
    by: ['currency'],
    where: { placedAt: { gte: since }, status: { in: paidStatuses } },
    _count: { _all: true },
    orderBy: { _count: { currency: 'desc' } },
    take: 1,
  });
  const currency = (dominant[0]?.currency ?? 'UGX') as CurrencyCode;

  const [topShops, topCategories, unpaidReservations] = await Promise.all([
    prisma.order.groupBy({
      by: ['shopId'],
      where: { placedAt: { gte: since }, status: { in: paidStatuses } },
      _sum: { totalMinor: true },
      _count: { _all: true },
      orderBy: { _sum: { totalMinor: 'desc' } },
      take: 10,
    }),
    prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: { placedAt: { gte: since }, status: { in: paidStatuses } } },
      _sum: { quantity: true, totalMinor: true },
      orderBy: { _sum: { totalMinor: 'desc' } },
      take: 10,
    }),
    prisma.order.count({ where: { status: 'AWAITING_PAYMENT', expiresAt: { lt: now } } }),
  ]);

  const shopRows = await prisma.shop.findMany({
    where: { id: { in: topShops.map((row) => row.shopId) } },
    select: { id: true, name: true, slug: true },
  });
  const productRows = await prisma.product.findMany({
    where: { id: { in: topCategories.map((row) => row.productId) } },
    select: { id: true, title: true, slug: true, shop: { select: { slug: true } } },
  });

  const delta = previousGmv === 0 ? null : ((gmvMinor - previousGmv) / previousGmv) * 100;

  return {
    window: { days, since, to: now, previousSince },
    currency,
    commissionBpsDefault: env().PLATFORM_COMMISSION_DEFAULT_BPS,
    gmv: {
      minor: gmvMinor,
      previousMinor: previousGmv,
      deltaPct: delta === null ? null : Math.round(delta * 10) / 10,
      orderCount: current._count._all,
      averageOrderMinor: Math.round(current._avg.totalMinor ?? 0),
      platformFeeMinor: Number(current._sum.platformFeeMinor ?? 0n),
      shippingMinor: Number(current._sum.shippingFeeMinor ?? 0n),
      discountsMinor: Number(current._sum.discountMinor ?? 0n),
    },
    ordersByStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
    cancellations: { count: cancellations, ratePct: current._count._all + cancellations === 0 ? 0 : Math.round((cancellations / (current._count._all + cancellations)) * 1000) / 10 },
    refunds: { count: refunds._count._all, minor: Number(refunds._sum.amountMinor ?? 0n) },
    growth: { newShops, newBuyers },
    paymentMix: rails.map((row) => ({
      provider: row.provider,
      count: row._count._all,
      minor: Number(row._sum.amountMinor ?? 0n),
    })),
    topShops: topShops.map((row) => {
      const shop = shopRows.find((candidate) => candidate.id === row.shopId);
      return shop ? { ...shop, orderCount: row._count._all, gmvMinor: Number(row._sum.totalMinor ?? 0n) } : null;
    }).filter((row): row is NonNullable<typeof row> => row !== null),
    topProducts: topCategories.map((row) => {
      const product = productRows.find((candidate) => candidate.id === row.productId);
      return product
        ? { id: product.id, title: product.title, slug: product.slug, shopSlug: product.shop.slug, sold: row._sum.quantity ?? 0, minor: Number(row._sum.totalMinor ?? 0n) }
        : null;
    }).filter((row): row is NonNullable<typeof row> => row !== null),
    alerts: {
      // Reservations that outlived their TTL still hold stock, so the job needs running.
      expiredUnpaidOrders: unpaidReservations,
      shopsAwaitingKyc: await prisma.shop.count({ where: { kycStatus: { in: ['SUBMITTED', 'UNDER_REVIEW'] }, deletedAt: null } }),
      productsAwaitingModeration: await prisma.product.count({ where: { status: 'PENDING_REVIEW', deletedAt: null } }),
    },
  };
}

/** `GET /api/admin/audit` — who changed what, newest first. */
export async function auditTrail(params: { entity?: AuditEntity; entityId?: string; actorId?: string; page: number; perPage: number }) {
  const where: Prisma.AuditLogWhereInput = {
    ...(params.entity ? { entity: params.entity } : {}),
    ...(params.entityId ? { entityId: params.entityId } : {}),
    ...(params.actorId ? { actorId: params.actorId } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      action: row.action,
      entity: row.entity,
      entityId: row.entityId,
      reason: row.reason,
      actor: row.actor,
      before: row.before ?? null,
      after: row.after ?? null,
    })),
    total,
    page: params.page,
    perPage: params.perPage,
    hasMore: params.page * params.perPage < total,
  };
}

/** The named accounts an admin can act as — the picker on the audit page. */
export async function adminStaff() {
  return prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, name: true, phone: true, status: true, lastLoginAt: true },
    orderBy: { name: 'asc' },
  });
}
