import 'server-only';
import { Prisma, prisma, type CurrencyCode, type Payout, type PayoutStatus, type Shop } from '../prisma';
import { conflict, forbidden, notFound, unprocessable } from '../http';
import { env } from '../env';

/**
 * Getting a seller their money.
 *
 * Three rules shape this whole module:
 *
 * 1. **The amount is never what the caller says.** A payout request carries a period; the
 *    figure is recomputed here from delivered orders. A seller cannot bid their own balance up.
 * 2. **The period is the ledger.** `Payout` has no join table to orders — a parcel belongs to
 *    whichever window its `deliveredAt` falls in. So windows may not overlap, and a new
 *    request must start where the last settled one ended, or the same order is paid twice.
 * 3. **Cash on delivery is not the platform's money to send.** The rider holds it. Those
 *    parcels are reported separately for rider reconciliation and never enter a payout.
 *
 * The seller's cut is the merchandise total minus the commission held back at checkout, plus
 * the delivery fee only when the seller ran the delivery themselves.
 */

const DELIVERED = 'DELIVERED' as const;

/** The rails where the platform genuinely received the buyer's money. */
export const RAIL_PROVIDERS = ['MTN_MOMO', 'AIRTEL_MONEY', 'STRIPE_CARD'] as const;

/**
 * The withdrawal floor, per currency, in minor units.
 * A UGX ten-thousand note is not worth a KES ten-thousand note, so the configured floor only
 * speaks for the primary market and the rest are stated here. Read lazily: `env()` must not
 * run at import time or `next build` fails on a machine without the payment secrets.
 */
function payoutMinimum(currency: CurrencyCode): number {
  if (currency === 'KES') return 250_000;
  if (currency === 'USD') return 20_000;
  return env().SELLER_PAYOUT_MIN_MINOR;
}

/** Orders delivered inside this window are not yet withdrawable — the dispute clock is running. */
export function settlementCutoff(now = new Date()) {
  return new Date(now.getTime() - env().SELLER_SETTLEMENT_DELAY_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Delivered, past the dispute window, and paid through a rail the platform controls.
 *
 * The `none` arm matters: an order whose MoMo prompt failed and which the rider then
 * collected cash for is cash the platform never held.
 */
function clearedOrders(shopId: string, cutoff: Date, from: Date, to: Date): Prisma.OrderWhereInput {
  return {
    shopId,
    status: DELIVERED,
    deliveredAt: { gte: from, lte: to },
    payments: {
      some: { status: 'SUCCEEDED', provider: { in: [...RAIL_PROVIDERS] } },
      none: { status: 'SUCCEEDED', provider: 'CASH_ON_DELIVERY' },
    },
  };
}

/** Where the last settled payout stopped, so the next window cannot re-pay the same parcels. */
export async function lastSettledPeriodEnd(shopId: string): Promise<Date | null> {
  const last = await prisma.payout.findFirst({
    where: { shopId, status: { in: ['APPROVED', 'SENT'] } },
    orderBy: { periodEnd: 'desc' },
    select: { periodEnd: true },
  });
  return last?.periodEnd ?? null;
}

/** The oldest delivery on record is the earliest anything can be paid from. */
async function firstEligibleDate(shopId: string): Promise<Date> {
  const first = await prisma.order.findFirst({
    where: { shopId, status: DELIVERED, deliveredAt: { not: null } },
    orderBy: { deliveredAt: 'asc' },
    select: { deliveredAt: true },
  });
  if (first?.deliveredAt) return first.deliveredAt;
  return prisma.shop
    .findUniqueOrThrow({ where: { id: shopId }, select: { createdAt: true } })
    .then((row) => row.createdAt);
}

const minorToLabel = (minor: number, currency: CurrencyCode) =>
  `${(minor / 100).toLocaleString('en-UG', { maximumFractionDigits: currency === 'UGX' ? 0 : 2 })} ${currency}`;

/**
 * The seller's wallet view: what can be withdrawn now, what is still clearing, and what a
 * rider is holding in cash.
 */
export async function payoutSummary(shop: Shop, now = new Date()) {
  const cutoff = settlementCutoff(now);
  const windowStart = (await lastSettledPeriodEnd(shop.id)) ?? (await firstEligibleDate(shop.id));

  const country = await prisma.country.findUnique({
    where: { id: shop.countryId },
    select: { currency: true },
  });
  const currency: CurrencyCode = country?.currency ?? 'UGX';

  const eligible = clearedOrders(shop.id, cutoff, windowStart, now);

  const [cleared, clearing, cashParcels, withdrawn, queued, account] = await Promise.all([
    prisma.order.aggregate({
      where: eligible,
      _sum: { subtotalMinor: true, discountMinor: true, platformFeeMinor: true, refundedMinor: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: {
        shopId: shop.id,
        status: DELIVERED,
        deliveredAt: { gt: cutoff },
        payments: { some: { status: 'SUCCEEDED', provider: { in: [...RAIL_PROVIDERS] } } },
      },
      _sum: { subtotalMinor: true, platformFeeMinor: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: {
        shopId: shop.id,
        status: DELIVERED,
        deliveredAt: { not: null },
        payments: { some: { status: 'SUCCEEDED', provider: 'CASH_ON_DELIVERY' } },
      },
      _sum: { totalMinor: true, platformFeeMinor: true },
      _count: { _all: true },
    }),
    prisma.payout.aggregate({
      where: { shopId: shop.id, status: { in: ['APPROVED', 'SENT'] } },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    prisma.payout.aggregate({
      where: { shopId: shop.id, status: 'REQUESTED' },
      _sum: { amountMinor: true },
    }),
    prisma.payoutAccount.findUnique({ where: { shopId: shop.id } }),
  ]);

  // A seller-run delivery (their own boda) is theirs to keep; a Bemz rider cost the platform.
  const selfShipping = await prisma.order.aggregate({
    where: { ...eligible, fulfilmentType: 'SELLER_SELF_DELIVERY' },
    _sum: { shippingFeeMinor: true },
  });

  const goodsMinor = Number(cleared._sum.subtotalMinor ?? 0n) - Number(cleared._sum.discountMinor ?? 0n);
  const availableMinor = Math.max(
    0,
    goodsMinor -
      Number(cleared._sum.platformFeeMinor ?? 0n) -
      Number(cleared._sum.refundedMinor ?? 0n) +
      Number(selfShipping._sum.shippingFeeMinor ?? 0n),
  );
  const requestedMinor = Number(queued._sum.amountMinor ?? 0n);

  return {
    currency,
    settlementDelayDays: env().SELLER_SETTLEMENT_DELAY_DAYS,
    minimumMinor: payoutMinimum(currency),
    minimumLabel: minorToLabel(payoutMinimum(currency), currency),
    windowStart,
    windowEnd: cutoff,
    clearedOrderCount: cleared._count._all,
    availableMinor,
    availableLabel: minorToLabel(availableMinor, currency),
    // Already requested but not yet sent — withheld so it cannot be requested twice.
    requestedMinor,
    withdrawableMinor: Math.max(0, availableMinor - requestedMinor),
    clearingMinor: Math.max(0, Number(clearing._sum.subtotalMinor ?? 0n) - Number(clearing._sum.platformFeeMinor ?? 0n)),
    clearingOrderCount: clearing._count._all,
    cashWithRidersMinor: Math.max(0, Number(cashParcels._sum.totalMinor ?? 0n) - Number(cashParcels._sum.platformFeeMinor ?? 0n)),
    cashParcelCount: cashParcels._count._all,
    lifetimeWithdrawnMinor: Number(withdrawn._sum.amountMinor ?? 0n),
    payoutCount: withdrawn._count._all,
    account: account
      ? {
          id: account.id,
          provider: account.provider,
          accountNumber: account.accountNumber,
          accountName: account.accountName,
          bankName: account.bankName,
          isVerified: account.isVerified,
        }
      : null,
    blockers: [
      account ? null : 'Add the mobile money number the payout should go to',
      account && !account.isVerified ? 'Confirm that number with support before your first payout' : null,
      shop.kycStatus !== 'APPROVED' ? 'Your ID documents must be approved before the first payout' : null,
      availableMinor < payoutMinimum(currency)
        ? `The smallest payout is ${minorToLabel(payoutMinimum(currency), currency)}`
        : null,
    ].filter((blocker): blocker is string => blocker !== null),
  };
}

export type PayoutRequestInput = { periodStart: string; periodEnd: string };

/**
 * `POST /api/seller/payouts`
 *
 * The window is what the seller picks; the money is what the ledger says. Two requests with
 * overlapping windows are rejected because the period is the only thing tying a payout to its
 * parcels.
 */
export async function requestPayout(shop: Shop, input: PayoutRequestInput) {
  if (shop.status === 'SUSPENDED') throw forbidden('A suspended shop cannot withdraw — contact support');
  if (shop.kycStatus !== 'APPROVED') throw forbidden('Your ID documents must be approved before the first payout');

  const account = await prisma.payoutAccount.findUnique({ where: { shopId: shop.id } });
  if (!account) throw unprocessable('Add the mobile money number the payout should go to');
  if (!account.isVerified) throw unprocessable('Confirm that mobile money number with support before withdrawing');

  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw unprocessable('Pick the period you want paid out');
  }
  if (periodStart >= periodEnd) throw unprocessable('The period end must come after the period start');

  const cutoff = settlementCutoff();
  if (periodEnd > cutoff) {
    throw unprocessable(
      `Parcels delivered in the last ${env().SELLER_SETTLEMENT_DELAY_DAYS} days are still inside the dispute window`,
    );
  }

  const lastEnd = await lastSettledPeriodEnd(shop.id);
  if (lastEnd && periodStart < lastEnd) {
    throw conflict('That period overlaps a payout already approved — start the next window where the last one ended');
  }
  const windowStart = lastEnd ?? (await firstEligibleDate(shop.id));
  if (periodStart < windowStart) {
    throw unprocessable(`The earliest unpaid delivery is on ${windowStart.toISOString().slice(0, 10)}`);
  }

  const overlap = await prisma.payout.findFirst({
    where: {
      shopId: shop.id,
      status: { in: ['REQUESTED', 'APPROVED', 'SENT'] },
      periodStart: { lt: periodEnd },
      periodEnd: { gt: periodStart },
    },
    select: { id: true },
  });
  if (overlap) throw conflict('An open payout request already covers part of that period');

  const eligible = clearedOrders(shop.id, cutoff, periodStart, periodEnd);
  const goods = await prisma.order.aggregate({
    where: eligible,
    _sum: { subtotalMinor: true, discountMinor: true, platformFeeMinor: true, refundedMinor: true },
    _count: { _all: true },
  });
  const selfShipping = await prisma.order.aggregate({
    where: { ...eligible, fulfilmentType: 'SELLER_SELF_DELIVERY' },
    _sum: { shippingFeeMinor: true },
  });

  const amountMinor =
    Number(goods._sum.subtotalMinor ?? 0n) -
    Number(goods._sum.discountMinor ?? 0n) -
    Number(goods._sum.platformFeeMinor ?? 0n) -
    Number(goods._sum.refundedMinor ?? 0n) +
    Number(selfShipping._sum.shippingFeeMinor ?? 0n);

  const country = await prisma.country.findUnique({ where: { id: shop.countryId }, select: { currency: true } });
  const currency: CurrencyCode = country?.currency ?? 'UGX';

  if (goods._count._all === 0) throw unprocessable('Nothing was delivered and cleared in that period');
  if (amountMinor <= 0) throw unprocessable('Commission and refunds leave nothing to withdraw for that period');

  const minimum = payoutMinimum(currency);
  if (amountMinor < minimum) {
    throw unprocessable(`The smallest payout is ${minorToLabel(minimum, currency)} — you have ${minorToLabel(amountMinor, currency)}`);
  }

  const payout = await prisma.payout.create({
    data: {
      shopId: shop.id,
      accountId: account.id,
      amountMinor: BigInt(amountMinor),
      currency,
      status: 'REQUESTED',
      periodStart,
      periodEnd,
    },
  });

  // Finance sees the queue by notification rather than by polling the table.
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true }, take: 10 });
  if (admins.length > 0) {
    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        channel: 'IN_APP' as const,
        status: 'QUEUED' as const,
        template: 'payout_requested',
        title: 'Payout requested',
        body: `${shop.name} asked for ${minorToLabel(amountMinor, currency)}`,
        data: { payoutId: payout.id, shopId: shop.id },
      })),
    });
  }

  return {
    id: payout.id,
    amountMinor,
    amountLabel: minorToLabel(amountMinor, currency),
    currency,
    status: payout.status,
    periodStart: payout.periodStart,
    periodEnd: payout.periodEnd,
    orderCount: goods._count._all,
    account: { provider: account.provider, accountNumber: account.accountNumber, accountName: account.accountName },
  };
}

type PayoutRow = Payout & {
  account?: { provider: string; accountNumber: string; accountName: string; bankName?: string | null } | null;
  processedBy?: { name: string | null } | null;
};

function toPayoutView(payout: PayoutRow) {
  return {
    id: payout.id,
    shopId: payout.shopId,
    amountMinor: Number(payout.amountMinor),
    currency: payout.currency,
    status: payout.status,
    periodStart: payout.periodStart,
    periodEnd: payout.periodEnd,
    providerReference: payout.providerReference,
    failureReason: payout.failureReason,
    processedAt: payout.processedAt,
    processedBy: payout.processedBy?.name ?? null,
    createdAt: payout.createdAt,
    account: payout.account ?? null,
  };
}

/** `GET /api/seller/payouts` */
export async function payoutHistory(shopId: string, params: { page: number; perPage: number }) {
  const [total, rows] = await Promise.all([
    prisma.payout.count({ where: { shopId } }),
    prisma.payout.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
      include: {
        account: { select: { provider: true, accountNumber: true, accountName: true } },
        processedBy: { select: { name: true } },
      },
    }),
  ]);

  return {
    items: rows.map(toPayoutView),
    total,
    page: params.page,
    perPage: params.perPage,
    hasMore: params.page * params.perPage < total,
  };
}

/** `DELETE /api/seller/payouts/[id]` — a mistake can be pulled back while it is still queued. */
export async function withdrawPayoutRequest(shop: Shop, payoutId: string) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId }, select: { id: true, shopId: true, status: true } });
  if (!payout) throw notFound('Payout request not found');
  if (payout.shopId !== shop.id) throw forbidden('That request belongs to another shop');
  if (payout.status !== 'REQUESTED') throw conflict('Finance has already picked this up — contact support');

  await prisma.payout.delete({ where: { id: payout.id } });
  return { withdrawn: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// FINANCE / ADMIN
// ─────────────────────────────────────────────────────────────────────────────

export const OPEN_PAYOUT_STATUSES: PayoutStatus[] = ['REQUESTED', 'APPROVED'];

/** `GET /api/admin/payouts` */
export async function adminPayoutQueue(params: { status?: PayoutStatus; shopId?: string; page: number; perPage: number }) {
  const where: Prisma.PayoutWhereInput = {
    ...(params.status ? { status: params.status } : { status: { in: OPEN_PAYOUT_STATUSES } }),
    ...(params.shopId ? { shopId: params.shopId } : {}),
  };

  const [total, rows, openValue] = await Promise.all([
    prisma.payout.count({ where }),
    prisma.payout.findMany({
      where,
      include: {
        account: { select: { provider: true, accountNumber: true, accountName: true, bankName: true } },
        processedBy: { select: { name: true } },
        shop: { select: { id: true, name: true, slug: true, kycStatus: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
    }),
    prisma.payout.aggregate({
      where: { status: { in: OPEN_PAYOUT_STATUSES } },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      ...toPayoutView(row),
      shop: { id: row.shop.id, name: row.shop.name, slug: row.shop.slug, kycStatus: row.shop.kycStatus, status: row.shop.status },
    })),
    total,
    page: params.page,
    perPage: params.perPage,
    hasMore: params.page * params.perPage < total,
    openTotalMinor: Number(openValue._sum.amountMinor ?? 0n),
    openCount: openValue._count._all,
  };
}

/**
 * `POST /api/admin/payouts/[id]/approve`
 *
 * Approval is a human decision recorded against a named admin. Nothing here calls the
 * payment operator: the MoMo credentials on this deployment are scoped to the *collection*
 * product, and disbursement is a different API. Finance sends the money in the operator
 * portal and pastes the reference back in with `markPayoutSent`.
 */
export async function approvePayout(payoutId: string, actorId: string, note?: string) {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { shop: { select: { id: true, name: true, kycStatus: true, ownerId: true } } },
  });
  if (!payout) throw notFound('Payout request not found');
  if (payout.status !== 'REQUESTED') throw conflict(`This request is already ${payout.status.toLowerCase()}`);
  if (payout.shop.kycStatus !== 'APPROVED') throw forbidden('Approve the seller KYC before paying them out');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.payout.update({
      where: { id: payoutId },
      data: { status: 'APPROVED', processedById: actorId, processedAt: new Date(), failureReason: note ?? null },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PAYOUT_APPROVE',
        entity: 'PAYOUT',
        entityId: payoutId,
        reason: note,
        before: { status: payout.status },
        after: { status: 'APPROVED', amountMinor: Number(payout.amountMinor), currency: payout.currency },
      },
    });
    return row;
  });

  notify(
    payout.shop.ownerId,
    'payout_approved',
    'Payout approved',
    `${minorToLabel(Number(payout.amountMinor), payout.currency)} is queued for transfer to ${payout.shop.name}.`,
    { payoutId },
  );

  return toPayoutView(updated);
}

/**
 * `POST /api/admin/payouts/[id]/sent`
 *
 * The operator reference is stored unique, so the same portal transfer cannot be booked
 * against two payouts.
 */
export async function markPayoutSent(payoutId: string, actorId: string, providerReference: string) {
  const payout = await prisma.payout.findUnique({
    where: { id: payoutId },
    include: { shop: { select: { ownerId: true, name: true } }, account: { select: { provider: true, accountNumber: true, accountName: true } } },
  });
  if (!payout) throw notFound('Payout request not found');
  if (payout.status === 'SENT') return toPayoutView(payout);
  if (payout.status !== 'APPROVED') throw conflict('Approve this request before marking it paid');

  const clash = await prisma.payout.findFirst({ where: { providerReference, id: { not: payoutId } }, select: { id: true } });
  if (clash) throw conflict('That operator reference is already booked to another payout');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.payout.update({
      where: { id: payoutId },
      data: { status: 'SENT', providerReference, processedById: actorId, processedAt: new Date(), failureReason: null },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PAYOUT_MARK_SENT',
        entity: 'PAYOUT',
        entityId: payoutId,
        after: { providerReference, amountMinor: Number(payout.amountMinor), currency: payout.currency },
      },
    });
    // Sales counters move only once the money has actually left, so a shop page never
    // advertises volume finance has not settled.
    await tx.shop.update({
      where: { id: payout.shopId },
      data: { totalSalesCount: { increment: 1 }, totalSalesMinor: { increment: payout.amountMinor } },
    });
    return row;
  });

  notify(
    payout.shop.ownerId,
    'payout_sent',
    'Payout sent',
    `${minorToLabel(Number(payout.amountMinor), payout.currency)} is on its way to ${payout.account.accountNumber}.`,
    { payoutId, providerReference },
  );

  return toPayoutView(updated);
}

/** A bounced transfer is not silently retried — the seller has to ask again. */
export async function failPayout(payoutId: string, actorId: string, reason: string) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId }, include: { shop: { select: { ownerId: true } } } });
  if (!payout) throw notFound('Payout request not found');
  if (payout.status === 'SENT') throw conflict('A payout already sent cannot be failed — reverse it instead');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.payout.update({
      where: { id: payoutId },
      data: { status: 'FAILED', failureReason: reason, processedById: actorId, processedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PAYOUT_FAIL',
        entity: 'PAYOUT',
        entityId: payoutId,
        reason,
        before: { status: payout.status },
        after: { status: 'FAILED' },
      },
    });
    return row;
  });

  notify(
    payout.shop.ownerId,
    'payout_failed',
    'Payout did not go through',
    `${reason} — request it again once the number is right.`,
    { payoutId },
  );

  return toPayoutView(updated);
}

/** Money that left and came back must stop counting as sales. */
export async function reversePayout(payoutId: string, actorId: string, reason: string) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId }, include: { shop: { select: { ownerId: true } } } });
  if (!payout) throw notFound('Payout request not found');
  if (payout.status !== 'SENT') throw conflict('Only a payout that was sent can be reversed');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.payout.update({
      where: { id: payoutId },
      data: { status: 'REVERSED', failureReason: reason, processedById: actorId, processedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'PAYOUT_REVERSE',
        entity: 'PAYOUT',
        entityId: payoutId,
        reason,
        before: { status: 'SENT' },
        after: { status: 'REVERSED' },
      },
    });
    await tx.shop.update({
      where: { id: payout.shopId },
      data: { totalSalesCount: { decrement: 1 }, totalSalesMinor: { decrement: payout.amountMinor } },
    });
    return row;
  });

  notify(payout.shop.ownerId, 'payout_reversed', 'Payout reversed', reason, { payoutId });

  return toPayoutView(updated);
}

/**
 * Notifications are written outside the payout transaction on purpose: a failed in-app
 * message must not roll back money that has genuinely left the platform.
 */
function notify(userId: string, template: string, title: string, body: string, data: Prisma.InputJsonObject) {
  void prisma.notification
    .create({ data: { userId, channel: 'IN_APP', status: 'SENT', template, title, body, data, sentAt: new Date() } })
    .catch(() => undefined);
}

/** Flat rows for the finance spreadsheet. */
export async function payoutLedger(params: { from: Date; to: Date; status?: PayoutStatus }) {
  const rows = await prisma.payout.findMany({
    where: {
      createdAt: { gte: params.from, lte: params.to },
      ...(params.status ? { status: params.status } : {}),
    },
    include: { shop: { select: { name: true, slug: true } }, account: true },
    orderBy: { createdAt: 'asc' },
  });

  return rows.map((row) => ({
    payoutId: row.id,
    createdAt: row.createdAt,
    shop: row.shop.name,
    shopSlug: row.shop.slug,
    amountMinor: Number(row.amountMinor),
    currency: row.currency,
    status: row.status,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    provider: row.account.provider,
    accountNumber: row.account.accountNumber,
    accountName: row.account.accountName,
    bankName: row.account.bankName,
    providerReference: row.providerReference,
    failureReason: row.failureReason,
  }));
}
