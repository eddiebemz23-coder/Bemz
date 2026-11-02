import 'server-only';
import { prisma, type CurrencyCode, type DeliveryZone } from '../prisma';
import { commissionFromBps } from '../money';
import { env } from '../env';
import { badRequest, notFound } from '../http';

/**
 * One place decides what a basket costs, so a quote, a checkout and a refund can never
 * disagree with each other.
 *
 * VAT treatment follows what a buyer actually sees on a receipt in Kampala or Nairobi:
 * advertised prices are VAT-INCLUSIVE, so `taxMinor` is the VAT already inside the money
 * the buyer pays (for seller payouts and VAT returns) and is NOT added on top.
 */

export type LineInput = {
  variantId: string;
  quantity: number;
};

export type PricedLine = {
  variantId: string;
  productId: string;
  shopId: string;
  shopName: string;
  productTitle: string;
  variantName: string;
  sku: string;
  imageUrl: string | null;
  unitPriceMinor: number;
  currency: CurrencyCode;
  quantity: number;
  weightGrams: number;
  availableStock: number;
  lineTotalMinor: number;
  commissionBps: number;
  commissionMinor: number;
};

export type ShopBasket = {
  shopId: string;
  shopName: string;
  currency: CurrencyCode;
  lines: PricedLine[];
  subtotalMinor: number;
  discountMinor: number;
  shippingFeeMinor: number;
  vatIncludedMinor: number;
  totalMinor: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  zoneId: number;
  zoneName: string;
  cashOnDeliveryAllowed: boolean;
};

export type BasketQuote = {
  currency: CurrencyCode;
  districtId: number;
  districtName: string;
  zone: Pick<DeliveryZone, 'id' | 'code' | 'name' | 'baseFeeMinor' | 'freeOverMinor'>;
  baskets: ShopBasket[];
  subtotalMinor: number;
  discountMinor: number;
  shippingFeeMinor: number;
  vatIncludedMinor: number;
  totalMinor: number;
  freeShippingSavedMinor: number;
  couponCode: string | null;
  couponMessage: string | null;
};

/** Loads variants with the shop/category context needed to price them. */
export async function loadPurchasableVariants(variantIds: string[]) {
  const variants = await prisma.productVariant.findMany({
    where: {
      id: { in: variantIds },
      isDisabled: false,
      deletedAt: null,
      product: {
        is: {
          status: 'ACTIVE',
          deletedAt: null,
          shop: { is: { status: 'ACTIVE', vacationMode: false, deletedAt: null } },
        },
      },
    },
    include: {
      product: {
        include: {
          shop: { include: { country: true } },
          categories: { include: { category: true }, orderBy: [{ isPrimary: 'desc' }] },
          images: { where: { variantId: null }, orderBy: { position: 'asc' }, take: 1 },
        },
      },
    },
  });

  const found = new Set(variants.map((variant) => variant.id));
  const missing = variantIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    // Also covers items whose shop went on vacation or was suspended since the page loaded.
    throw notFound(`These items are no longer on sale: ${missing.join(', ')}`);
  }
  return variants;
}

export async function resolveDeliveryTarget(districtId: number) {
  const found = await prisma.district.findUnique({
    where: { id: districtId },
    include: { zone: { include: { country: true } }, country: true },
  });
  if (!found) throw notFound('That delivery district does not exist');
  if (!found.zone) throw badRequest(`No delivery zone is configured for ${found.name} yet`);
  if (!found.zone.isActive) throw badRequest(`We are not delivering to ${found.name} right now`);
  if (!found.country) throw badRequest(`${found.name} has no country record — the geo data needs reseeding`);

  // Narrowing happens here so callers never re-check `zone`/`country` for null.
  return { ...found, zone: found.zone, country: found.country };
}

/**
 * Commission precedence: explicit shop rate (negotiated accounts) > category rate >
 * platform default. Read from the DB each time so a renegotiated rate applies instantly.
 */
export function commissionBpsFor(params: {
  shopCommissionBps: number | null | undefined;
  categoryCommissionBps: number | undefined;
}): number {
  if (params.shopCommissionBps != null) return Math.round(Number(params.shopCommissionBps));
  if (params.categoryCommissionBps != null) return params.categoryCommissionBps;
  return env().PLATFORM_COMMISSION_DEFAULT_BPS;
}

export const vatIncludedMinor = (netInclusiveMinor: number, taxRateBps: number): number =>
  Math.round(netInclusiveMinor - netInclusiveMinor / (1 + taxRateBps / 10_000));

type CouponLike = {
  id: string;
  code: string;
  discountType: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
  valueBps: number | null;
  fixedAmountMinor: number | null;
  maxDiscountMinor: number | null;
  minOrderMinor: number | null;
  isStorewide: boolean;
  scope: 'PLATFORM' | 'SHOP';
  shopId: string | null;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  usedCount: number;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
};

export async function findActiveCoupon(code: string): Promise<CouponLike | null> {
  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon) return null;
  return coupon as unknown as CouponLike;
}

export type CouponVerdict = { ok: true; coupon: CouponLike } | { ok: false; reason: string };

export function evaluateCouponEligibility(
  coupon: CouponLike | null,
  context: { subtotalMinor: number; now: Date; userRedemptions: number; shopIds: string[] },
): CouponVerdict {
  if (!coupon) return { ok: false, reason: 'That coupon code is not recognised' };
  if (!coupon.isActive) return { ok: false, reason: 'That coupon is no longer active' };
  if (context.now < coupon.startsAt) return { ok: false, reason: 'That coupon starts later' };
  if (context.now > coupon.endsAt) return { ok: false, reason: 'That coupon has expired' };
  if (coupon.minOrderMinor != null && context.subtotalMinor < coupon.minOrderMinor) {
    return { ok: false, reason: 'Your basket is below the minimum for that coupon' };
  }
  if (coupon.usageLimitTotal != null && coupon.usedCount >= coupon.usageLimitTotal) {
    return { ok: false, reason: 'That coupon has been fully claimed' };
  }
  if (coupon.usageLimitPerUser != null && context.userRedemptions >= coupon.usageLimitPerUser) {
    return { ok: false, reason: 'You have already used that coupon' };
  }
  if (coupon.scope === 'SHOP' && coupon.shopId && !context.shopIds.includes(coupon.shopId)) {
    return { ok: false, reason: 'That coupon only works in its own shop' };
  }
  return { ok: true, coupon };
}

function shopDiscountFor(coupon: CouponLike, basketSubtotal: number, appliesToShop: boolean): number {
  if (coupon.discountType === 'FREE_SHIPPING') return 0;
  if (!appliesToShop) return 0;

  if (coupon.discountType === 'FIXED_AMOUNT') return Math.min(coupon.fixedAmountMinor ?? 0, basketSubtotal);

  const bps = coupon.valueBps ?? 0;
  const raw = Math.round((basketSubtotal * bps) / 10_000);
  return Math.min(basketSubtotal, coupon.maxDiscountMinor != null ? Math.min(raw, coupon.maxDiscountMinor) : raw);
}

/**
 * Prices a basket per shop. Multi-seller carts split into one order per shop, and the
 * free-shipping threshold is evaluated per shop against that shop's own subtotal —
 * exactly how the courier networks bill a pickup.
 */
export async function quoteBasket(params: {
  lines: LineInput[];
  districtId: number;
  couponCode?: string | null;
  userId?: string | null;
  allowCashOnDelivery?: boolean;
}): Promise<BasketQuote> {
  if (params.lines.length === 0) throw badRequest('Your cart is empty');

  const variants = await loadPurchasableVariants(params.lines.map((line) => line.variantId));
  const district = await resolveDeliveryTarget(params.districtId);
  const quantityByVariant = new Map(params.lines.map((line) => [line.variantId, line.quantity]));

  const currencies = new Set(variants.map((variant) => variant.product.shop.country.currency));
  if (currencies.size > 1) {
    throw badRequest('A cart cannot mix Ugandan and Kenyan sellers — checkout each shop separately');
  }
  const currency = [...currencies][0] as CurrencyCode;
  if (currency !== district.country.currency) {
    throw badRequest(
      `Shop currency ${currency} cannot deliver to ${district.name} (${district.country.currency})`,
    );
  }

  const pricedLines: PricedLine[] = variants.map((variant) => {
    const quantity = quantityByVariant.get(variant.id) ?? 1;
    const availableStock = variant.stockQuantity - variant.reservedQuantity;
    if (availableStock < 1) {
      throw badRequest(`${variant.product.title} (${variant.name}) is sold out`);
    }
    if (variant.maxQuantityPerOrder && quantity > variant.maxQuantityPerOrder) {
      throw badRequest(`Only ${variant.maxQuantityPerOrder} of ${variant.name} per order`);
    }
    if (quantity > availableStock) {
      throw badRequest(`Only ${availableStock} left of ${variant.product.title} (${variant.name})`);
    }

    const commissionBps = commissionBpsFor({
      shopCommissionBps: variant.product.shop.commissionRateBps ? Number(variant.product.shop.commissionRateBps) : null,
      categoryCommissionBps: variant.product.categories[0]?.category.commissionRateBps,
    });
    const lineTotalMinor = variant.priceMinor * quantity;

    return {
      variantId: variant.id,
      productId: variant.productId,
      shopId: variant.product.shopId,
      shopName: variant.product.shop.name,
      productTitle: variant.product.title,
      variantName: variant.name,
      sku: variant.sku,
      imageUrl: variant.product.images[0]?.url ?? null,
      unitPriceMinor: variant.priceMinor,
      currency,
      quantity,
      weightGrams: (variant.weightGrams ?? variant.product.weightGrams ?? 500) * quantity,
      availableStock,
      lineTotalMinor,
      commissionBps,
      commissionMinor: commissionFromBps(lineTotalMinor, commissionBps),
    };
  });

  const coupon = params.couponCode ? await findActiveCoupon(params.couponCode) : null;
  const userRedemptions =
    coupon && params.userId
      ? await prisma.couponRedemption.count({
          where: { couponId: coupon.id, userId: params.userId },
        })
      : 0;

  const subtotalAll = pricedLines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
  const verdict = coupon
    ? evaluateCouponEligibility(coupon, {
        subtotalMinor: subtotalAll,
        now: new Date(),
        userRedemptions,
        shopIds: [...new Set(pricedLines.map((line) => line.shopId))],
      })
    : null;

  const couponMessage =
    coupon && verdict && !verdict.ok ? verdict.reason : coupon && verdict?.ok ? `${coupon.code} applied` : null;
  const appliedCoupon = verdict?.ok ? verdict.coupon : null;

  const grouped = new Map<string, PricedLine[]>();
  for (const line of pricedLines) {
    const bucket = grouped.get(line.shopId) ?? [];
    bucket.push(line);
    grouped.set(line.shopId, bucket);
  }

  const shopIds = [...grouped.keys()];
  const shops = await prisma.shop.findMany({ where: { id: { in: shopIds } } });
  const shopById = new Map(shops.map((shop) => [shop.id, shop]));
  const estimates = await prisma.shippingEstimate.findMany({
    where: { shopId: { in: shopIds }, zoneId: district.zone.id },
  });
  const estimateByShop = new Map(estimates.map((estimate) => [estimate.shopId, estimate]));

  const baskets: ShopBasket[] = [];
  for (const [shopId, lines] of grouped) {
    const shop = shopById.get(shopId);
    if (!shop) continue;

    const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
    const appliesToShop = appliedCoupon ? appliedCoupon.scope === 'PLATFORM' || appliedCoupon.shopId === shopId : false;
    const discountMinor = appliedCoupon ? shopDiscountFor(appliedCoupon, subtotalMinor, appliesToShop) : 0;

    const estimate = estimateByShop.get(shopId);
    const totalWeightGrams = lines.reduce((sum, line) => sum + line.weightGrams, 0);
    const baseFee = estimate?.feeOverrideMinor ?? district.zone.baseFeeMinor;
    const extraKg = Math.max(0, Math.ceil((totalWeightGrams - 2_000) / 1_000));
    const grossShipping = baseFee + extraKg * district.zone.perKgFeeMinor;

    const freeByThreshold =
      (district.zone.freeOverMinor != null && subtotalMinor - discountMinor >= district.zone.freeOverMinor) ||
      appliedCoupon?.discountType === 'FREE_SHIPPING';

    const shippingFeeMinor = freeByThreshold ? 0 : grossShipping;
    const netSubtotal = subtotalMinor - discountMinor + shippingFeeMinor;
    const vatIncludedMinorAmount = vatIncludedMinor(netSubtotal, district.country.taxRateBps);

    baskets.push({
      shopId,
      shopName: shop.name,
      currency,
      lines,
      subtotalMinor,
      discountMinor,
      shippingFeeMinor,
      vatIncludedMinor: vatIncludedMinorAmount,
      totalMinor: netSubtotal,
      estimatedDaysMin: estimate?.daysMin ?? district.zone.estimatedDaysMin,
      estimatedDaysMax: estimate?.daysMax ?? district.zone.estimatedDaysMax,
      zoneId: district.zone.id,
      zoneName: district.zone.name,
      cashOnDeliveryAllowed: district.zone.cashOnDeliveryAllowed && (params.allowCashOnDelivery ?? true),
    });
  }

  const sumOf = (pick: (basket: ShopBasket) => number) => baskets.reduce((sum, basket) => sum + pick(basket), 0);

  return {
    currency,
    districtId: district.id,
    districtName: district.name,
    zone: {
      id: district.zone.id,
      code: district.zone.code,
      name: district.zone.name,
      baseFeeMinor: district.zone.baseFeeMinor,
      freeOverMinor: district.zone.freeOverMinor,
    },
    baskets,
    subtotalMinor: sumOf((basket) => basket.subtotalMinor),
    discountMinor: sumOf((basket) => basket.discountMinor),
    shippingFeeMinor: sumOf((basket) => basket.shippingFeeMinor),
    vatIncludedMinor: sumOf((basket) => basket.vatIncludedMinor),
    totalMinor: sumOf((basket) => basket.totalMinor),
    freeShippingSavedMinor: appliedCoupon?.discountType === 'FREE_SHIPPING' ? district.zone.baseFeeMinor : 0,
    couponCode: appliedCoupon?.code ?? null,
    couponMessage,
  };
}
