import 'server-only';
import { Prisma, prisma, type Product, type ProductStatus, type Shop } from '../prisma';
import { conflict, forbidden, notFound, unprocessable } from '../http';
import { productSlugTaken, uniqueSlug } from '../slug';
import { thumbUrl, destroyAsset } from '../cloudinary';
import { assertMayListInCategory } from '../auth/guards';
import type {
  createProductSchema,
  productQuerySchema,
  updateProductSchema,
  createVariantSchema,
  updateVariantSchema,
  stockAdjustmentSchema,
  productImagesSchema,
} from '../validation/catalog';
import type { z } from 'zod';

/**
 * Catalog reads for buyers and catalog writes for sellers.
 *
 * Two rules shape this file:
 *   1. `Product.startingPriceMinor` and `discountPct` are denormalised from the variants,
 *      because a listing grid must filter and sort on price without joining per row.
 *      Every mutation that touches a price calls `recomputePriceDenorms`.
 *   2. Stock is never trusted from the client. `stockQuantity` is on-hand,
 *      `reservedQuantity` is in-flight, and the number a buyer is allowed to add is the gap.
 */

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type VariantCreateInput = z.infer<typeof createVariantSchema>;
export type VariantUpdateInput = z.infer<typeof updateVariantSchema>;
export type StockAdjustInput = z.infer<typeof stockAdjustmentSchema>;
export type ProductImagesInput = z.infer<typeof productImagesSchema>;

const OPEN_SHOP = { deletedAt: null, status: 'ACTIVE', vacationMode: false } as const;

// ─────────────────────────────────────────────────────────────────────────────
// BUYER LISTING
// ─────────────────────────────────────────────────────────────────────────────

const listInclude = {
  shop: { select: { id: true, name: true, slug: true, isVerified: true, country: { select: { code: true } } } },
  images: { where: { variantId: null }, orderBy: { position: 'asc' }, take: 2 },
  categories: { where: { isPrimary: true }, include: { category: { select: { name: true, slug: true } } } },
  variants: {
    where: { isDisabled: false, deletedAt: null },
    select: { priceMinor: true, compareAtPriceMinor: true, stockQuantity: true, reservedQuantity: true },
  },
} satisfies Prisma.ProductInclude;

type ListRow = Prisma.ProductGetPayload<{ include: typeof listInclude }>;

export type ProductListItem = ReturnType<typeof toListItem>;

function toListItem(row: ListRow) {
  const cheapest = row.variants.reduce<number | null>(
    (min, variant) => (min === null || variant.priceMinor < min ? variant.priceMinor : min),
    null,
  );
  // The strike-through price is the highest compare-at among the cheapest options, so the
  // "-45%" badge never shows a discount the buyer cannot actually get.
  const compareAt = row.variants
    .filter((variant) => variant.priceMinor === cheapest)
    .reduce<number | null>(
      (best, variant) => (variant.compareAtPriceMinor === null ? best : Math.max(best ?? 0, variant.compareAtPriceMinor)),
      null,
    );

  const cover = row.images.find((image) => image.isPrimary) ?? row.images[0];

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    brand: row.brand,
    condition: row.condition,
    currency: row.currency,
    startingPriceMinor: row.startingPriceMinor ?? cheapest,
    compareAtPriceMinor: compareAt,
    discountPct: row.discountPct,
    ratingAvg: row.ratingAvg === null ? null : Number(row.ratingAvg),
    ratingCount: row.ratingCount,
    soldCount: row.soldCount,
    availableStock: row.variants.reduce((sum, variant) => sum + Math.max(0, variant.stockQuantity - variant.reservedQuantity), 0),
    imageUrl: cover?.url ?? null,
    thumbImageUrl: cover ? thumbUrl(cover.url) : null,
    secondImageUrl: row.images.find((image) => image.id !== cover?.id)?.url ?? null,
    fulfilmentType: row.fulfilmentType,
    isDigital: row.isDigital,
    createdAt: row.createdAt,
    shop: {
      id: row.shop.id,
      name: row.shop.name,
      slug: row.shop.slug,
      isVerified: row.shop.isVerified,
      country: row.shop.country.code,
    },
    categories: row.categories.map((link) => ({ name: link.category.name, slug: link.category.slug })),
  };
}

function orderForSort(sort: string): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ startingPriceMinor: 'asc' }, { createdAt: 'desc' }];
    case 'price_desc':
      return [{ startingPriceMinor: 'desc' }, { createdAt: 'desc' }];
    case 'popular':
      return [{ soldCount: 'desc' }, { viewsCount: 'desc' }];
    case 'rating':
      return [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }];
    default:
      return [{ createdAt: 'desc' }];
  }
}

/**
 * `GET /api/products`
 *
 * Text search uses ILIKE rather than the tsvector column: the trigger and GIN indexes are
 * added by prisma/sql/search_vector.sql, which is applied separately, and the endpoint has
 * to behave on a database where it has not run yet.
 */
export async function listPublicProducts(query: z.infer<typeof productQuerySchema>) {
  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    status: 'ACTIVE',
    shop: { is: OPEN_SHOP },
  };

  if (query.q) {
    const term = query.q.trim();
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { subtitle: { contains: term, mode: 'insensitive' } },
      { brand: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
      { shop: { is: { name: { contains: term, mode: 'insensitive' } } } },
    ];
  }

  if (query.categorySlug) {
    const category = await prisma.category.findUnique({ where: { slug: query.categorySlug }, select: { path: true } });
    if (!category) {
      return { items: [] as ProductListItem[], total: 0, page: query.page, perPage: query.perPage, hasMore: false };
    }
    // `path` is materialised ("electronics/phones"), so one prefix match covers the subtree.
    where.categories = { some: { category: { path: { startsWith: category.path } } } };
  }

  if (query.shopSlug) where.shop = { is: { ...OPEN_SHOP, slug: query.shopSlug } };
  if (query.brand) where.brand = { contains: query.brand, mode: 'insensitive' };
  if (query.minRating != null) where.ratingAvg = { gte: query.minRating };

  // All variant conditions must hold on ONE variant, hence the AND inside `some`.
  const variantConditions: Prisma.ProductVariantWhereInput[] = [{ isDisabled: false }, { deletedAt: null }];

  if (query.minPriceMinor != null || query.maxPriceMinor != null) {
    variantConditions.push({
      priceMinor: {
        gte: query.minPriceMinor ?? 0,
        lte: query.maxPriceMinor ?? Number.MAX_SAFE_INTEGER,
      },
    });
  }
  if (query.inStockOnly === 'true') {
    // On-hand only: in-flight reservations are enforced again at add-to-cart and checkout.
    variantConditions.push({ stockQuantity: { gt: 0 } });
  }
  if (query.attributes) {
    const parsed = JSON.parse(query.attributes) as Record<string, string | number>;
    for (const [key, value] of Object.entries(parsed)) {
      variantConditions.push({ attributes: { path: [key], equals: String(value) } });
    }
  }
  where.variants = { some: { AND: variantConditions } };

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: listInclude,
      orderBy: orderForSort(query.sort),
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    }),
  ]);

  return {
    items: rows.map(toListItem),
    total,
    page: query.page,
    perPage: query.perPage,
    hasMore: query.page * query.perPage < total,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUYER DETAIL
// ─────────────────────────────────────────────────────────────────────────────

const detailInclude = {
  shop: {
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      phone: true,
      whatsappNumber: true,
      isVerified: true,
      isOfficialStore: true,
      ratingAvg: true,
      ratingCount: true,
      totalSalesCount: true,
      dispatchSlaHours: true,
      defaultFulfilment: true,
      vacationMode: true,
      status: true,
      country: { select: { code: true, name: true, currency: true, taxRateBps: true, taxLabel: true } },
      baseDistrict: {
        select: {
          name: true,
          code: true,
          zone: { select: { name: true, code: true, baseFeeMinor: true, freeOverMinor: true, estimatedDaysMin: true, estimatedDaysMax: true } },
        },
      },
    },
  },
  images: { where: { variantId: null }, orderBy: { position: 'asc' } },
  categories: {
    include: { category: { select: { id: true, name: true, slug: true, path: true, commissionRateBps: true, requiresKyc: true } } },
  },
  variants: {
    where: { deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { priceMinor: 'asc' }],
    include: { images: { orderBy: { position: 'asc' } } },
  },
  attributes: { orderBy: [{ name: 'asc' }, { position: 'asc' }] },
  questions: {
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: {
      user: { select: { name: true } },
      answers: { orderBy: { createdAt: 'asc' }, include: { responder: { select: { name: true } } } },
    },
  },
} satisfies Prisma.ProductInclude;

export type ProductDetailRow = Prisma.ProductGetPayload<{ include: typeof detailInclude }>;

/**
 * `/api/products/[shopSlug]/[productSlug]` — the listing page.
 *
 * A PENDING_REVIEW product is readable by everyone but never buyable: sellers paste the
 * link into WhatsApp to show support where an item is stuck in moderation.
 */
export async function getProductForShop(shopSlug: string, productSlug: string): Promise<ProductDetailRow> {
  const product = await prisma.product.findFirst({
    where: { slug: productSlug, deletedAt: null, shop: { is: { slug: shopSlug, deletedAt: null } } },
    include: detailInclude,
  });
  if (!product) throw notFound('That listing is not here any more');
  if (product.status === 'ARCHIVED' || product.status === 'REJECTED' || product.status === 'DRAFT') {
    throw notFound('That listing is not published');
  }
  return product;
}

export async function getProductById(id: string): Promise<ProductDetailRow> {
  const product = await prisma.product.findUnique({ where: { id }, include: detailInclude });
  if (!product || product.deletedAt) throw notFound('That listing is not here any more');
  return product;
}

/** Public projection: cost prices, reservations and moderation notes never leave the server. */
export function toPublicProduct(product: ProductDetailRow) {
  const primaryLink = product.categories.find((link) => link.isPrimary) ?? product.categories[0];

  const variants = product.variants
    .filter((variant) => !variant.isDisabled)
    .map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      attributes: variant.attributes,
      priceMinor: variant.priceMinor,
      compareAtPriceMinor: variant.compareAtPriceMinor,
      currency: variant.currency,
      isPrimary: variant.isPrimary,
      availableStock: Math.max(0, variant.stockQuantity - variant.reservedQuantity),
      maxQuantityPerOrder: variant.maxQuantityPerOrder,
      weightGrams: variant.weightGrams,
      images: variant.images.map((image) => ({ url: image.url, thumbUrl: thumbUrl(image.url), altText: image.altText })),
    }));

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle,
    description: product.description,
    brand: product.brand,
    condition: product.condition,
    status: product.status,
    currency: product.currency,
    startingPriceMinor: product.startingPriceMinor,
    discountPct: product.discountPct,
    warrantyText: product.warrantyText,
    fulfilmentType: product.fulfilmentType,
    isDigital: product.isDigital,
    weightGrams: product.weightGrams,
    ratingAvg: product.ratingAvg === null ? null : Number(product.ratingAvg),
    ratingCount: product.ratingCount,
    soldCount: product.soldCount,
    viewsCount: product.viewsCount,
    wishlistsCount: product.wishlistsCount,
    metaTitle: product.metaTitle,
    metaDescription: product.metaDescription,
    createdAt: product.createdAt,
    purchasable: product.status === 'ACTIVE',
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      thumbUrl: thumbUrl(image.url),
      altText: image.altText,
      position: image.position,
      isPrimary: image.isPrimary,
    })),
    variants,
    availableStock: variants.reduce((sum, variant) => sum + variant.availableStock, 0),
    facets: product.attributes.reduce<Record<string, string[]>>((acc, attribute) => {
      acc[attribute.name] = [...(acc[attribute.name] ?? []), attribute.value];
      return acc;
    }, {}),
    primaryCategory: primaryLink
      ? { id: primaryLink.category.id, name: primaryLink.category.name, slug: primaryLink.category.slug, path: primaryLink.category.path }
      : null,
    categories: product.categories.map((link) => ({
      name: link.category.name,
      slug: link.category.slug,
      isPrimary: link.isPrimary,
    })),
    shop: {
      id: product.shop.id,
      name: product.shop.name,
      slug: product.shop.slug,
      logoUrl: product.shop.logoUrl,
      isVerified: product.shop.isVerified,
      isOfficialStore: product.shop.isOfficialStore,
      ratingAvg: product.shop.ratingAvg === null ? null : Number(product.shop.ratingAvg),
      ratingCount: product.shop.ratingCount,
      totalSalesCount: product.shop.totalSalesCount,
      dispatchSlaHours: product.shop.dispatchSlaHours,
      defaultFulfilment: product.shop.defaultFulfilment,
      country: product.shop.country,
      fromDistrict: product.shop.baseDistrict?.name ?? null,
      deliveryZone: product.shop.baseDistrict?.zone ?? null,
      isOpen: product.shop.status === 'ACTIVE' && !product.shop.vacationMode,
      contactPhone: product.shop.phone,
    },
    questions: product.questions.map((question) => ({
      id: question.id,
      body: question.body,
      askedBy: question.user.name ?? 'A buyer',
      askedAt: question.createdAt,
      answers: question.answers.map((answer) => ({
        id: answer.id,
        body: answer.body,
        by: answer.responder.name ?? 'Seller',
        isFromSeller: answer.isFromSeller,
        at: answer.createdAt,
      })),
    })),
  };
}

export type PublicProduct = ReturnType<typeof toPublicProduct>;

export async function registerProductView(productId: string): Promise<void> {
  // A failed counter must never fail a page view.
  await prisma.product.update({ where: { id: productId }, data: { viewsCount: { increment: 1 } } }).catch(() => undefined);
}

/** "More in this category" strip on the listing page. */
export async function relatedProducts(product: ProductDetailRow, limit = 8) {
  const categoryId = product.categories.find((link) => link.isPrimary)?.categoryId;
  const where: Prisma.ProductWhereInput = {
    status: 'ACTIVE',
    deletedAt: null,
    id: { not: product.id },
    shop: { is: OPEN_SHOP },
    variants: { some: { isDisabled: false, deletedAt: null, stockQuantity: { gt: 0 } } },
  };
  if (categoryId) where.categories = { some: { categoryId } };

  const rows = await prisma.product.findMany({ where, include: listInclude, orderBy: { soldCount: 'desc' }, take: limit });
  const items = rows.map(toListItem);
  // Without a category match the strip would be empty, so fall back to the same shop.
  if (items.length > 0) return items;

  const fromShop = await prisma.product.findMany({
    where: { ...where, shopId: product.shopId },
    include: listInclude,
    orderBy: { soldCount: 'desc' },
    take: limit,
  });
  return fromShop.map(toListItem);
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: READ
// ─────────────────────────────────────────────────────────────────────────────

const sellerInclude = {
  variants: {
    where: { deletedAt: null },
    orderBy: { priceMinor: 'asc' as const },
    include: { _count: { select: { inventoryMovements: true } } },
  },
  images: { where: { variantId: null }, orderBy: { position: 'asc' as const }, take: 1 },
  categories: { include: { category: { select: { id: true, name: true, slug: true, requiresKyc: true } } } },
} satisfies Prisma.ProductInclude;

export async function listSellerProducts(
  shopId: string,
  params: { status?: string; q?: string; page: number; perPage: number },
) {
  const where: Prisma.ProductWhereInput = {
    shopId,
    deletedAt: null,
    ...(params.status ? { status: params.status as ProductStatus } : {}),
    ...(params.q ? { title: { contains: params.q, mode: 'insensitive' } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: sellerInclude,
      orderBy: { updatedAt: 'desc' },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      status: row.status,
      currency: row.currency,
      brand: row.brand,
      condition: row.condition,
      fulfilmentType: row.fulfilmentType,
      rejectionReason: row.rejectionReason,
      startingPriceMinor: row.startingPriceMinor,
      soldCount: row.soldCount,
      viewsCount: row.viewsCount,
      ratingCount: row.ratingCount,
      imageUrl: row.images[0]?.url ?? null,
      categories: row.categories.map((link) => ({ id: link.categoryId, name: link.category.name, requiresKyc: link.category.requiresKyc })),
      variants: row.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        priceMinor: variant.priceMinor,
        compareAtPriceMinor: variant.compareAtPriceMinor,
        costPriceMinor: variant.costPriceMinor,
        stockQuantity: variant.stockQuantity,
        reservedQuantity: variant.reservedQuantity,
        available: Math.max(0, variant.stockQuantity - variant.reservedQuantity),
        lowStockThreshold: variant.lowStockThreshold,
        isDisabled: variant.isDisabled,
        isPrimary: variant.isPrimary,
      })),
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
    })),
    total,
    page: params.page,
    perPage: params.perPage,
    hasMore: params.page * params.perPage < total,
  };
}

export type SellerProductRow = Prisma.ProductGetPayload<{ include: typeof sellerInclude }>;

/** The seller sees their own draft or rejected listing, including the moderation note. */
export async function getSellerProduct(shop: Shop, productId: string): Promise<SellerProductRow> {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: sellerInclude });
  if (!product || product.deletedAt) throw notFound('That listing is not here any more');
  if (product.shopId !== shop.id) throw forbidden('That listing belongs to another shop');
  return product;
}

const sellerDetailInclude = {
  ...sellerInclude,
  images: { orderBy: [{ variantId: 'asc' as const }, { position: 'asc' as const }] },
} satisfies Prisma.ProductInclude;

/**
 * The listing *editor* needs every photo and every variant; the grid only needs the cover.
 * Keeping these two reads apart is what stops a twelve-photo listing from pulling 1 200 px
 * originals into a dashboard that shows thirty products.
 */
export async function getSellerProductDetail(shop: Shop, productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId }, include: sellerDetailInclude });
  if (!product || product.deletedAt) throw notFound('That listing is not here any more');
  if (product.shopId !== shop.id) throw forbidden('That listing belongs to another shop');
  return product;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: PRICE DENORMALISATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recomputes `startingPriceMinor` / `discountPct` from the live variants. Runs inside the
 * caller's transaction so a grid never renders a price the buyer cannot be charged.
 */
export async function recomputePriceDenorms(tx: Prisma.TransactionClient, productId: string): Promise<void> {
  const variants = await tx.productVariant.findMany({
    where: { productId, isDisabled: false, deletedAt: null },
    select: { priceMinor: true, compareAtPriceMinor: true },
  });
  if (variants.length === 0) {
    await tx.product.update({ where: { id: productId }, data: { startingPriceMinor: null, discountPct: null } });
    return;
  }

  const prices = variants.map((variant) => variant.priceMinor);
  const starting = Math.min(...prices);
  const compareCandidates = variants
    .filter((variant) => variant.priceMinor === starting && variant.compareAtPriceMinor !== null)
    .map((variant) => variant.compareAtPriceMinor as number);
  const compareAt = compareCandidates.length > 0 ? Math.max(...compareCandidates) : null;
  const discountPct = compareAt && compareAt > starting ? Math.round(((compareAt - starting) / compareAt) * 100) : null;

  await tx.product.update({ where: { id: productId }, data: { startingPriceMinor: starting, discountPct } });
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: CATEGORY LINKS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Categories drive commission and the KYC gate, so they are validated rather than trusted:
 * an unknown id would silently price the order at the default commission.
 */
async function resolveCategories(categoryIds: string[], primaryCategoryId?: string) {
  const uniqueIds = [...new Set(categoryIds)];
  const found = await prisma.category.findMany({
    where: { id: { in: uniqueIds }, isActive: true },
    select: { id: true, name: true, requiresKyc: true },
  });

  if (found.length !== uniqueIds.length) {
    const known = new Set(found.map((category) => category.id));
    const missing = uniqueIds.filter((id) => !known.has(id)).join(', ');
    throw unprocessable(`Category ${missing} is not available for listing`);
  }
  if (primaryCategoryId && !found.some((category) => category.id === primaryCategoryId)) {
    throw unprocessable('The primary category must be one of the selected categories');
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: CREATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creating a listing is one transaction: product + variants + images + facet rows.
 * A half-saved listing is worse than a failed one, because the seller would see stock that
 * no order can ever reference.
 */
export async function createProduct(shop: Shop, input: CreateProductInput) {
  const categories = await resolveCategories(input.categoryIds, input.primaryCategoryId);
  const requiresKyc = categories.some((category) => category.requiresKyc);
  await assertMayListInCategory(shop, { requiresKyc });

  if (shop.status === 'SUSPENDED') throw forbidden('Your shop is suspended — settle the issue with support before listing');

  const facetValues = new Map<string, Set<string>>();
  for (const variant of input.variants) {
    for (const [key, value] of Object.entries(variant.attributes)) {
      facetValues.set(key, (facetValues.get(key) ?? new Set()).add(value));
    }
  }

  const status: ProductStatus = input.publish ? (shop.status === 'ACTIVE' && !requiresKyc ? 'ACTIVE' : 'PENDING_REVIEW') : 'DRAFT';
  const primaryCurrency = input.currency;
  if (input.variants.some((variant) => variant.priceMinor <= 0)) throw unprocessable('Every option needs a price above zero');

  const product = await prisma.$transaction(async (tx) => {
    const slug = await uniqueSlug(input.title, (candidate) => productSlugTaken(shop.id, candidate));

    const created = await tx.product.create({
      data: {
        shopId: shop.id,
        title: input.title,
        slug,
        subtitle: input.subtitle,
        description: input.description,
        brand: input.brand,
        condition: input.condition,
        status,
        fulfilmentType: input.fulfilmentType,
        warrantyText: input.warrantyText,
        currency: primaryCurrency,
        isDigital: input.isDigital,
        weightGrams: input.weightGrams,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        metaTitle: input.metaTitle ?? input.title.slice(0, 70),
        metaDescription: input.metaDescription ?? input.subtitle ?? input.description.slice(0, 170),
        requiresModeration: requiresKyc || shop.status !== 'ACTIVE',
        categories: {
          create: categories.map((category) => ({
            categoryId: category.id,
            isPrimary: category.id === (input.primaryCategoryId ?? categories[0]?.id),
          })),
        },
        images: {
          create: input.images.map((image, index) => ({
            url: image.url,
            publicId: image.publicId,
            thumbUrl: thumbUrl(image.url),
            altText: image.altText ?? `${input.title} photo ${index + 1}`,
            position: image.position,
            isPrimary: image.isPrimary ?? index === 0,
          })),
        },
        attributes: {
          create: [...facetValues.entries()].flatMap(([name, values], dimensionIndex) =>
            [...values].map((value, valueIndex) => ({
              name,
              value,
              position: dimensionIndex * 20 + valueIndex,
            })),
          ),
        },
      },
      include: { variants: true, images: true },
    });

    // Variants are created after the product row so the primary flag has a stable target.
    await tx.productVariant.createMany({
      data: input.variants.map((variant) => ({
        productId: created.id,
        sku: variant.sku,
        name: variant.name,
        attributes: variant.attributes as Prisma.InputJsonValue,
        priceMinor: variant.priceMinor,
        compareAtPriceMinor: variant.compareAtPriceMinor,
        costPriceMinor: variant.costPriceMinor,
        currency: primaryCurrency,
        stockQuantity: variant.stockQuantity,
        weightGrams: variant.weightGrams,
        maxQuantityPerOrder: variant.maxQuantityPerOrder,
        isPrimary: variant.isPrimary ?? false,
      })),
    });

    await recomputePriceDenorms(tx, created.id);

    // Exactly one primary image and one primary variant, whatever the client sent.
    const primaryImage = created.images.find((image) => image.isPrimary);
    if (!primaryImage && created.images.length > 0) {
      await tx.productImage.update({ where: { id: created.images[0]!.id }, data: { isPrimary: true } });
    }

    const variantCount = await tx.productVariant.count({ where: { productId: created.id } });
    if (variantCount > 0) {
      const first = await tx.productVariant.findFirst({ where: { productId: created.id, isPrimary: false }, orderBy: { priceMinor: 'asc' }, select: { id: true } });
      const hasPrimary = await tx.productVariant.findFirst({ where: { productId: created.id, isPrimary: true }, select: { id: true } });
      if (!hasPrimary && first) await tx.productVariant.update({ where: { id: first.id }, data: { isPrimary: true } });
    }

    return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: sellerInclude });
  });

  return { product, status, moderationRequired: status === 'PENDING_REVIEW' };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: UPDATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A seller asking for `ACTIVE` is asking to be published, not publishing themselves. A listing
 * that has never been reviewed, or one an admin rejected, is sent back to the queue instead —
 * otherwise "create as DRAFT, then PATCH the status" walks straight past moderation.
 */
function publishTarget(product: { requiresModeration: boolean; status: ProductStatus }, requested: ProductStatus): ProductStatus {
  if (requested !== 'ACTIVE') return requested;
  if (product.requiresModeration || product.status === 'REJECTED') return 'PENDING_REVIEW';
  return requested;
}

export async function updateProduct(shop: Shop, productId: string, patch: UpdateProductInput) {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    include: { categories: { select: { categoryId: true, isPrimary: true } } },
  });
  if (!existing || existing.deletedAt) throw notFound('That listing is not here any more');
  if (existing.shopId !== shop.id) throw forbidden('That listing belongs to another shop');

  const data: Prisma.ProductUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.subtitle !== undefined) data.subtitle = patch.subtitle;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.brand !== undefined) data.brand = patch.brand;
  if (patch.condition !== undefined) data.condition = patch.condition;
  if (patch.fulfilmentType !== undefined) data.fulfilmentType = patch.fulfilmentType;
  if (patch.warrantyText !== undefined) data.warrantyText = patch.warrantyText;
  if (patch.weightGrams !== undefined) data.weightGrams = patch.weightGrams;
  if (patch.metaTitle !== undefined) data.metaTitle = patch.metaTitle;
  if (patch.metaDescription !== undefined) data.metaDescription = patch.metaDescription;

  // Editing a rejected listing goes back to the queue automatically.
  let nextStatus: ProductStatus | undefined = patch.status ? publishTarget(existing, patch.status) : undefined;
  if (nextStatus) {
    if (nextStatus === 'ACTIVE') {
      const links = existing.categories.length > 0 ? existing.categories : [];
      const ids = links.map((link) => link.categoryId);
      if (ids.length > 0) {
        const categories = await prisma.category.findMany({ where: { id: { in: ids } }, select: { requiresKyc: true } });
        await assertMayListInCategory(shop, { requiresKyc: categories.some((category) => category.requiresKyc) });
      }
      if (shop.status !== 'ACTIVE' && shop.status !== 'SUSPENDED') throw forbidden('Activate your shop before publishing');
      if (shop.status === 'SUSPENDED') throw forbidden('Your shop is suspended');
    }
    data.status = nextStatus;
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: productId }, data });

    if (patch.categoryIds && patch.categoryIds.length > 0) {
      const categories = await resolveCategories(patch.categoryIds, patch.primaryCategoryId);
      const requiresKyc = categories.some((category) => category.requiresKyc);
      await assertMayListInCategory(shop, { requiresKyc });

      await tx.productCategory.deleteMany({ where: { productId } });
      await tx.productCategory.createMany({
        data: categories.map((category) => ({
          productId,
          categoryId: category.id,
          isPrimary: category.id === (patch.primaryCategoryId ?? categories[0]?.id),
        })),
      });
    }

    return tx.product.findUniqueOrThrow({ where: { id: productId }, include: sellerInclude });
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: VARIANTS
// ─────────────────────────────────────────────────────────────────────────────

async function requireOwnVariant(shop: Shop, variantId: string) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: { select: { id: true, shopId: true, status: true, currency: true, deletedAt: true } } },
  });
  if (!variant || variant.deletedAt || variant.product.deletedAt) throw notFound('That option no longer exists');
  if (variant.product.shopId !== shop.id) throw forbidden('That option belongs to another shop');
  return variant;
}

export async function addVariant(shop: Shop, productId: string, input: VariantCreateInput) {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, shopId: true, currency: true, deletedAt: true } });
  if (!product || product.deletedAt) throw notFound('That listing is not here any more');
  if (product.shopId !== shop.id) throw forbidden('That listing belongs to another shop');

  const variant = await prisma.$transaction(async (tx) => {
    const created = await tx.productVariant.create({
      data: {
        productId: product.id,
        sku: input.sku,
        name: input.name,
        attributes: input.attributes as Prisma.InputJsonValue,
        priceMinor: input.priceMinor,
        compareAtPriceMinor: input.compareAtPriceMinor,
        costPriceMinor: input.costPriceMinor,
        currency: product.currency,
        stockQuantity: input.stockQuantity,
        weightGrams: input.weightGrams,
        maxQuantityPerOrder: input.maxQuantityPerOrder,
        isPrimary: input.isPrimary ?? false,
      },
    });

    if (input.isPrimary) await tx.productVariant.updateMany({ where: { productId: product.id, id: { not: created.id } }, data: { isPrimary: false } });

    await recomputePriceDenorms(tx, product.id);
    return created;
  });

  return variant;
}

export async function updateVariant(shop: Shop, variantId: string, input: VariantUpdateInput) {
  const variant = await requireOwnVariant(shop, variantId);

  const data: Prisma.ProductVariantUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.attributes !== undefined) data.attributes = input.attributes as Prisma.InputJsonValue;
  if (input.compareAtPriceMinor !== undefined) data.compareAtPriceMinor = input.compareAtPriceMinor;
  if (input.costPriceMinor !== undefined) data.costPriceMinor = input.costPriceMinor;
  if (input.weightGrams !== undefined) data.weightGrams = input.weightGrams;
  if (input.maxQuantityPerOrder !== undefined) data.maxQuantityPerOrder = input.maxQuantityPerOrder;
  if (input.isDisabled !== undefined) data.isDisabled = input.isDisabled;

  // Price changes only; stock moves through adjustStock so every unit is on the ledger.
  if (input.priceMinor !== undefined) {
    if (input.compareAtPriceMinor && input.compareAtPriceMinor <= input.priceMinor) {
      throw unprocessable('A compare-at price must be higher than the selling price');
    }
    data.priceMinor = input.priceMinor;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.productVariant.update({ where: { id: variantId }, data });
    if (input.isPrimary) await tx.productVariant.updateMany({ where: { productId: variant.productId, id: { not: variantId } }, data: { isPrimary: false } });
    await recomputePriceDenorms(tx, variant.productId);
    return row;
  });

  return updated;
}

/** Soft delete: order items and stock history keep pointing at the option. */
export async function retireVariant(shop: Shop, variantId: string) {
  const variant = await requireOwnVariant(shop, variantId);
  if (variant.reservedQuantity > 0) {
    throw conflict('This option is held in a buyer basket — clear the reservations before retiring it');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.productVariant.update({
      where: { id: variantId },
      data: { deletedAt: new Date(), isDisabled: true, stockQuantity: 0 },
    });
    await recomputePriceDenorms(tx, variant.productId);
    return row;
  });

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: STOCK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A signed delta on the stock ledger.
 *
 * The guard is the `WHERE stockQuantity + delta >= 0` clause: a shrinkage that would take a
 * variant below zero, or below what buyers already have reserved, is rejected instead of
 * silently going negative. `idempotencyKey` makes a retrying dashboard button harmless.
 */
export async function adjustStock(shop: Shop, variantId: string, input: StockAdjustInput, actorId: string) {
  const variant = await requireOwnVariant(shop, variantId);

  if (input.idempotencyKey) {
    const seen = await prisma.inventoryMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { id: true, delta: true, balanceAfter: true } });
    if (seen) return { ...seen, duplicate: true };
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.$executeRaw`
      UPDATE product_variants
         SET "stockQuantity" = "stockQuantity" + ${input.delta},
             "updatedAt" = now()
       WHERE id = ${variantId}
         AND "deletedAt" IS NULL
         AND "stockQuantity" + ${input.delta} >= 0
         AND "stockQuantity" + ${input.delta} >= "reservedQuantity"`;

    if (updated !== 1) {
      throw unprocessable(
        input.delta < 0
          ? 'That would leave less stock than buyers already have in their baskets'
          : 'This option is no longer available to restock',
      );
    }

    const fresh = await tx.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQuantity: true, reservedQuantity: true, lowStockThreshold: true },
    });

    await tx.inventoryMovement.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      update: {},
      create: {
        variantId,
        shopId: shop.id,
        reason: input.reason,
        delta: input.delta,
        balanceAfter: fresh.stockQuantity,
        actorId,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
      },
    });

    // Crossing the low-stock line downwards is the one alert a seller always wants.
    const wasAbove = fresh.stockQuantity - input.delta > fresh.lowStockThreshold;
    if (input.delta < 0 && wasAbove && fresh.stockQuantity <= fresh.lowStockThreshold) {
      await tx.notification.create({
        data: {
          userId: shop.ownerId,
          channel: 'IN_APP',
          status: 'SENT',
          template: 'low_stock',
          title: 'Running low',
          body: `${variant.name} is down to ${fresh.stockQuantity} unit${fresh.stockQuantity === 1 ? '' : 's'}`,
          data: { variantId, productId: variant.productId, stockQuantity: fresh.stockQuantity },
          sentAt: new Date(),
        },
      });
    }

    return { id: '', delta: input.delta, balanceAfter: fresh.stockQuantity, duplicate: false };
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: IMAGES
// ─────────────────────────────────────────────────────────────────────────────

export async function addProductImages(shop: Shop, productId: string, input: ProductImagesInput) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, shopId: true, deletedAt: true, title: true },
  });
  if (!product || product.deletedAt) throw notFound('That listing is not here any more');
  if (product.shopId !== shop.id) throw forbidden('That listing belongs to another shop');

  const count = await prisma.productImage.count({ where: { productId, variantId: null } });
  if (count + input.images.length > 20) throw unprocessable('A listing carries at most 20 photos');

  const images = await prisma.$transaction(async (tx) => {
    const hasPrimary = await tx.productImage.findFirst({ where: { productId, variantId: null, isPrimary: true }, select: { id: true } });

    await tx.productImage.createMany({
      data: input.images.map((image, index) => ({
        productId,
        variantId: image.variantId,
        url: image.url,
        publicId: image.publicId,
        thumbUrl: thumbUrl(image.url),
        altText: image.altText ?? `${product.title} photo ${count + index + 1}`,
        position: image.position,
        isPrimary: hasPrimary ? false : (image.isPrimary ?? index === 0),
      })),
    });

    return tx.productImage.findMany({ where: { productId }, orderBy: { position: 'asc' } });
  });

  return images;
}

/** Removing the cover would leave a blank tile in every grid, so the next photo inherits it. */
export async function deleteProductImage(shop: Shop, imageId: string) {
  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    include: { product: { select: { id: true, shopId: true } } },
  });
  if (!image) throw notFound('That photo is already gone');
  if (image.product.shopId !== shop.id) throw forbidden('That photo belongs to another shop');

  await prisma.$transaction(async (tx) => {
    await tx.productImage.delete({ where: { id: imageId } });
    if (image.isPrimary) {
      const next = await tx.productImage.findFirst({
        where: { productId: image.productId, variantId: null, id: { not: imageId } },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      if (next) await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
  });

  // Orphaned Cloudinary assets keep costing storage; the delete is best-effort.
  await destroyAsset(image.publicId).catch(() => false);
  return { deleted: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: PUBLISH / RETIRE
// ─────────────────────────────────────────────────────────────────────────────

export async function setProductStatus(shop: Shop, productId: string, status: ProductStatus) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { categories: { include: { category: { select: { requiresKyc: true } } } }, variants: { select: { stockQuantity: true, reservedQuantity: true, isDisabled: true } } },
  });
  if (!product || product.deletedAt) throw notFound('That listing is not here any more');
  if (product.shopId !== shop.id) throw forbidden('That listing belongs to another shop');

  const target = publishTarget(product, status);

  // The seller's *intent* is validated, not the status we end up writing: an unapproved
  // listing asking to go live must still have stock, or it enters the queue as an empty shell.
  if (status === 'ACTIVE') {
    await assertMayListInCategory(shop, { requiresKyc: product.categories.some((link) => link.category.requiresKyc) });
    if (shop.status === 'SUSPENDED') throw forbidden('Your shop is suspended');
    const sellable = product.variants.filter((variant) => !variant.isDisabled && variant.stockQuantity - variant.reservedQuantity > 0);
    if (sellable.length === 0) throw unprocessable('Add stock to at least one option before publishing');
  }

  return prisma.product.update({
    where: { id: productId },
    data: {
      status: target,
      // Re-queued listings lose an old rejection note so support reads the current state.
      ...(target === 'PENDING_REVIEW' ? { rejectionReason: null, moderatedAt: null } : {}),
    },
    include: sellerInclude,
  });
}

/** Sellers retire listings; only an admin hard-deletes, and the row is kept for order history. */
export async function retireProduct(shop: Shop, productId: string) {
  const held = await prisma.productVariant.count({ where: { productId, reservedQuantity: { gt: 0 } } });
  if (held > 0) throw conflict('Buyers still hold stock from this listing — cancel or deliver those orders first');

  return prisma.product.update({ where: { id: productId }, data: { deletedAt: new Date(), status: 'ARCHIVED' } });
}
