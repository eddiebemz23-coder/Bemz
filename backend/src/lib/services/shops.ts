import 'server-only';
import { Prisma, prisma, type Shop } from '../prisma';
import { conflict, forbidden, notFound, unprocessable } from '../http';
import { uniqueSlug, shopSlugTaken } from '../slug';
import { tryNormalisePhone, normalisePhone } from '../phone';
import { env } from '../env';
import { signedUploadParams, isCloudinaryConfigured, buildPublicId, destroyAsset, signedViewUrl, type UploadTarget } from '../cloudinary';
import type { shopQuerySchema, updateShopSchema, kycSubmissionSchema } from '../validation/catalog';
import type { z } from 'zod';

/**
 * Shopfront reads and the seller-side shop management writes.
 *
 * A shop in this market is a stall, not a company: it opens with a phone number and a
 * district, and it goes quiet with `vacationMode` when the trader travels upcountry for
 * stock rather than deleting the listings.
 */

export type UpdateShopInput = z.infer<typeof updateShopSchema>;
export type KycSubmission = z.infer<typeof kycSubmissionSchema>;

const shopCardSelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  bannerUrl: true,
  tagline: true,
  description: true,
  phone: true,
  isVerified: true,
  isOfficialStore: true,
  ratingAvg: true,
  ratingCount: true,
  totalSalesCount: true,
  followers: true,
  vacationMode: true,
  defaultFulfilment: true,
  dispatchSlaHours: true,
  createdAt: true,
  country: { select: { code: true, name: true, currency: true } },
  baseDistrict: { select: { id: true, name: true, code: true, zone: { select: { name: true, estimatedDaysMin: true, estimatedDaysMax: true } } } },
  _count: { select: { products: true } },
} satisfies Prisma.ShopSelect;

type ShopCard = Prisma.ShopGetPayload<{ select: typeof shopCardSelect }>;

function toShopCard(shop: ShopCard) {
  return {
    id: shop.id,
    name: shop.name,
    slug: shop.slug,
    logoUrl: shop.logoUrl,
    bannerUrl: shop.bannerUrl,
    tagline: shop.tagline,
    description: shop.description,
    // The shop line is a business number; it is only disclosed on the shop page itself.
    phone: shop.phone,
    isVerified: shop.isVerified,
    isOfficialStore: shop.isOfficialStore,
    ratingAvg: shop.ratingAvg === null ? null : Number(shop.ratingAvg),
    ratingCount: shop.ratingCount,
    totalSalesCount: shop.totalSalesCount,
    followers: shop.followers,
    vacationMode: shop.vacationMode,
    defaultFulfilment: shop.defaultFulfilment,
    dispatchSlaHours: shop.dispatchSlaHours,
    country: shop.country,
    basedIn: shop.baseDistrict
      ? {
          id: shop.baseDistrict.id,
          name: shop.baseDistrict.name,
          code: shop.baseDistrict.code,
          zone: shop.baseDistrict.zone?.name ?? null,
          estimatedDaysMin: shop.baseDistrict.zone?.estimatedDaysMin ?? null,
          estimatedDaysMax: shop.baseDistrict.zone?.estimatedDaysMax ?? null,
        }
      : null,
    productCount: shop._count.products,
    since: shop.createdAt,
  };
}

/**
 * `GET /api/shops`
 *
 * Only open shops are listed; a suspended or closed stall disappears from discovery but
 * its order history stays readable for the buyer and for support.
 */
export async function listPublicShops(query: z.infer<typeof shopQuerySchema>) {
  const where: Prisma.ShopWhereInput = {
    deletedAt: null,
    status: 'ACTIVE',
    ...(query.country ? { country: { is: { code: query.country } } } : {}),
    ...(query.verifiedOnly === 'true' ? { isVerified: true } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { tagline: { contains: query.q, mode: 'insensitive' } },
            { products: { some: { status: 'ACTIVE', title: { contains: query.q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.shop.count({ where }),
    prisma.shop.findMany({
      where,
      select: shopCardSelect,
      // Verified stalls with real sales first — the shape of trust a buyer reads on a shop grid.
      orderBy: [{ isVerified: 'desc' }, { totalSalesCount: 'desc' }, { ratingAvg: 'desc' }],
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    }),
  ]);

  return {
    items: rows.map(toShopCard),
    total,
    page: query.page,
    perPage: query.perPage,
    hasMore: query.page * query.perPage < total,
  };
}

/**
 * The public shop page: identity, what it sells, and the newest listings.
 *
 * `topCategories` is derived from live products, because a stall that claims "phones and
 * tablets" but has none in stock is the complaint that brings a buyer back to Jumia.
 */
export async function getShopBySlug(slug: string) {
  const shop = await prisma.shop.findFirst({
    where: { slug, deletedAt: null, status: { in: ['ACTIVE', 'PENDING'] } },
    select: shopCardSelect,
  });
  if (!shop) throw notFound('That shop is not open');

  const card = toShopCard(shop);

  const [categoryRows, reviewRows, newest] = await Promise.all([
    prisma.productCategory.groupBy({
      by: ['categoryId'],
      where: { product: { shopId: shop.id, status: 'ACTIVE', deletedAt: null } },
      _count: { _all: true },
      orderBy: { _count: { categoryId: 'desc' } },
      take: 6,
    }),
    prisma.review.groupBy({
      by: ['rating'],
      where: { shopId: shop.id, status: 'PUBLISHED' },
      _count: { _all: true },
    }),
    prisma.product.findMany({
      where: { shopId: shop.id, status: 'ACTIVE', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { id: true, slug: true, title: true, startingPriceMinor: true, currency: true, discountPct: true, images: { where: { variantId: null }, take: 1, select: { url: true } } },
    }),
  ]);

  const categories = await prisma.category.findMany({
    where: { id: { in: categoryRows.map((row) => row.categoryId) } },
    select: { id: true, name: true, slug: true, imageUrl: true },
  });

  const breakdown = [5, 4, 3, 2, 1].map((star) => ({
    rating: star,
    count: reviewRows.find((row) => row.rating === star)?._count._all ?? 0,
  }));

  return {
    shop: card,
    categories: categoryRows
      .map((row) => {
        const category = categories.find((candidate) => candidate.id === row.categoryId);
        return category ? { ...category, productCount: row._count._all } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null),
    ratingBreakdown: breakdown,
    products: newest.map((product) => ({
      id: product.id,
      slug: product.slug,
      title: product.title,
      startingPriceMinor: product.startingPriceMinor,
      currency: product.currency,
      discountPct: product.discountPct,
      imageUrl: product.images[0]?.url ?? null,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SELLER: SHOP MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slug to id for routes that key off the shop (reviews, product grids) without needing the
 * whole shop page. Same visibility rule as `getShopBySlug`, so a suspended stall cannot be
 * reached by id from a slug that no longer resolves.
 */
export async function resolvePublicShopId(slug: string): Promise<string> {
  const shop = await prisma.shop.findFirst({
    where: { slug, deletedAt: null, status: { in: ['ACTIVE', 'PENDING'] } },
    select: { id: true },
  });
  if (!shop) throw notFound('That shop is not open');
  return shop.id;
}

/** Everything the seller dashboard header needs in one read. */
export async function sellerShopOverview(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: {
      country: { select: { code: true, name: true, currency: true, taxRateBps: true, taxLabel: true } },
      baseDistrict: { select: { id: true, name: true, code: true, zone: { select: { name: true, baseFeeMinor: true, freeOverMinor: true } } } },
      payoutAccount: { select: { id: true, provider: true, accountNumber: true, accountName: true, isVerified: true } },
      kycDocuments: { select: { id: true, type: true, status: true, reviewNote: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!shop) throw notFound('Shop not found');

  const [statusCounts, stockCounts, listingsByStatus, money] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], where: { shopId }, _count: { _all: true } }),
    prisma.productVariant.count({
      where: { product: { shopId, deletedAt: null }, deletedAt: null, isDisabled: false, stockQuantity: { lte: 0 } },
    }),
    prisma.product.groupBy({ by: ['status'], where: { shopId, deletedAt: null }, _count: { _all: true } }),
    prisma.order.aggregate({
      where: { shopId, status: { in: ['DELIVERED', 'OUT_FOR_DELIVERY', 'PACKED'] } },
      _sum: { subtotalMinor: true, platformFeeMinor: true, shippingFeeMinor: true },
    }),
  ]);

  const byStatus = statusCounts.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = row._count._all;
    return acc;
  }, {});

  return {
    shop: {
      id: shop.id,
      name: shop.name,
      slug: shop.slug,
      status: shop.status,
      kycStatus: shop.kycStatus,
      isVerified: shop.isVerified,
      vacationMode: shop.vacationMode,
      logoUrl: shop.logoUrl,
      bannerUrl: shop.bannerUrl,
      tagline: shop.tagline,
      description: shop.description,
      phone: shop.phone,
      whatsappNumber: shop.whatsappNumber,
      email: shop.email,
      streetAddress: shop.streetAddress,
      defaultFulfilment: shop.defaultFulfilment,
      dispatchSlaHours: shop.dispatchSlaHours,
      commissionRateBps: shop.commissionRateBps === null ? null : Number(shop.commissionRateBps),
      ratingAvg: shop.ratingAvg === null ? null : Number(shop.ratingAvg),
      ratingCount: shop.ratingCount,
      followers: shop.followers,
      totalSalesCount: shop.totalSalesCount,
      totalSalesMinor: Number(shop.totalSalesMinor),
      currency: shop.country.currency,
      country: { code: shop.country.code, name: shop.country.name, taxRateBps: shop.country.taxRateBps, taxLabel: shop.country.taxLabel },
      basedIn: shop.baseDistrict
        ? {
            id: shop.baseDistrict.id,
            name: shop.baseDistrict.name,
            zone: shop.baseDistrict.zone?.name ?? null,
            zoneBaseFeeMinor: shop.baseDistrict.zone?.baseFeeMinor ?? null,
            freeOverMinor: shop.baseDistrict.zone?.freeOverMinor ?? null,
          }
        : null,
      payoutAccount: shop.payoutAccount,
      kyc: {
        status: shop.kycStatus,
        documents: shop.kycDocuments.map((document) => ({
          id: document.id,
          type: document.type,
          status: document.status,
          reviewNote: document.reviewNote,
          submittedAt: document.createdAt,
        })),
      },
    },
    counts: {
      ordersByStatus: byStatus,
      productsByStatus: listingsByStatus.reduce<Record<string, number>>((acc, row) => {
        acc[row.status] = row._count._all;
        return acc;
      }, {}),
      openOrders:
        (byStatus.CONFIRMED ?? 0) + (byStatus.PACKED ?? 0) + (byStatus.OUT_FOR_DELIVERY ?? 0) + (byStatus.AWAITING_CONFIRMATION ?? 0),
      outOfStockVariants: stockCounts,
      grossSalesMinor: Number(money._sum.subtotalMinor ?? 0),
      platformFeesMinor: Number(money._sum.platformFeeMinor ?? 0),
      shippingCollectedMinor: Number(money._sum.shippingFeeMinor ?? 0),
    },
  };
}

/**
 * `PATCH /api/shops/[shopId]`
 *
 * Renaming keeps the old URL working: `slug` only changes when the seller explicitly asks
 * for a new store link, because links to a stall live in WhatsApp forever.
 */
export async function updateShop(shop: Shop, patch: UpdateShopInput) {
  const data: Prisma.ShopUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.tagline !== undefined) data.tagline = patch.tagline;
  if (patch.description !== undefined) data.description = patch.description;
  if (patch.streetAddress !== undefined) data.streetAddress = patch.streetAddress;
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.defaultFulfilment !== undefined) data.defaultFulfilment = patch.defaultFulfilment;
  if (patch.dispatchSlaHours !== undefined) data.dispatchSlaHours = patch.dispatchSlaHours;

  if (patch.phone !== undefined) {
    const result = tryNormalisePhone(patch.phone);
    if (!result.ok) throw unprocessable(`Shop phone: ${result.message}`);
    data.phone = result.phone.e164;
  }
  if (patch.whatsappNumber !== undefined) {
    data.whatsappNumber = patch.whatsappNumber ? normalisePhone(patch.whatsappNumber).e164 : null;
  }

  if (patch.baseDistrictId !== undefined) {
    const district = await prisma.district.findUnique({
      where: { id: patch.baseDistrictId },
      select: { id: true, zone: { select: { isActive: true } } },
    });
    if (!district) throw unprocessable('Choose the district you dispatch from');
    data.baseDistrict = { connect: { id: district.id } };
  }

  if (patch.slug !== undefined && patch.slug !== shop.slug) {
    const slug = await uniqueSlug(patch.slug, (candidate) => shopSlugTaken(candidate));
    data.slug = slug;
  }

  if (Object.keys(data).length === 0) throw unprocessable('Nothing to update');

  return prisma.shop.update({
    where: { id: shop.id },
    data,
    select: { id: true, name: true, slug: true, tagline: true, description: true, phone: true, whatsappNumber: true, email: true, baseDistrictId: true, defaultFulfilment: true, dispatchSlaHours: true, status: true },
  });
}

/**
 * Vacation mode hides the shop from search and blocks new purchases while the trader is
 * upcountry for stock; the listings and the order history stay exactly as they were.
 */
export async function setVacationMode(shop: Shop, on: boolean) {
  if (!on && shop.status !== 'ACTIVE') throw forbidden('Support must reopen your shop');

  return prisma.shop.update({
    where: { id: shop.id },
    data: { vacationMode: on },
    select: { id: true, vacationMode: true, name: true, slug: true },
  });
}

/**
 * Closing a shop is the seller's call and is reversible; suspension is ours.
 * Products are archived so a reopening does not resurrect stale prices.
 */
export async function closeShop(shop: Shop) {
  if (shop.status === 'CLOSED') return { already: true };

  const openOrders = await prisma.order.count({
    where: { shopId: shop.id, status: { in: ['CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY', 'AWAITING_CONFIRMATION', 'AWAITING_PAYMENT'] } },
  });
  if (openOrders > 0) throw conflict(`Finish or cancel ${openOrders} open order${openOrders === 1 ? '' : 's'} before closing`);

  const unsettled = await prisma.payout.count({ where: { shopId: shop.id, status: { in: ['REQUESTED', 'APPROVED'] } } });
  if (unsettled > 0) throw conflict('A payout is still in flight — support has to settle it first');

  await prisma.$transaction([
    prisma.product.updateMany({ where: { shopId: shop.id, deletedAt: null }, data: { status: 'ARCHIVED' } }),
    prisma.shop.update({ where: { id: shop.id }, data: { status: 'CLOSED', vacationMode: false } }),
  ]);

  return { closed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// KYC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * KYC gates the categories where counterfeits and chargebacks cost the most: phones,
 * tablets, building materials, agro-chemicals. Documents are stored as private Cloudinary
 * assets, and this read path is admin-only — a seller sees status, never another
 * seller's file.
 */
export async function submitKyc(shop: Shop, input: KycSubmission) {
  if (shop.kycStatus === 'APPROVED') throw conflict('Your documents are already approved');

  const documents = input.documents.map((document) => ({
    type: document.type,
    publicId: document.publicId,
    url: document.url,
    expiresAt: document.expiresAt ? new Date(document.expiresAt) : null,
  }));

  const seen = new Set<string>();
  for (const document of documents) {
    if (seen.has(document.type)) throw unprocessable(`Only one ${document.type.toLowerCase().replace(/_/g, ' ')} document is needed`);
    seen.add(document.type);
  }

  // A national ID is the minimum for a person-to-person payout; nothing else proves identity.
  if (!documents.some((document) => document.type === 'NATIONAL_ID') && shop.kycStatus === 'NOT_SUBMITTED') {
    throw unprocessable('A photo of your national ID is required to sell here');
  }

  await prisma.$transaction(async (tx) => {
    for (const document of documents) {
      await tx.kycDocument.upsert({
        where: { shopId_type: { shopId: shop.id, type: document.type } },
        update: {
          fileUrl: document.url,
          publicId: document.publicId,
          status: 'SUBMITTED',
          expiresAt: document.expiresAt,
          reviewNote: null,
          reviewedAt: null,
          reviewerId: null,
        },
        create: {
          shopId: shop.id,
          type: document.type,
          fileUrl: document.url,
          publicId: document.publicId,
          status: 'SUBMITTED',
          expiresAt: document.expiresAt,
        },
      });
    }

    await tx.shop.update({
      where: { id: shop.id },
      data: {
        kycStatus: 'SUBMITTED',
        nationalIdNumber: input.nationalIdNumber ?? shop.nationalIdNumber,
        taxPin: input.taxPin ?? shop.taxPin,
        kycBusinessName: input.businessName ?? shop.kycBusinessName,
      },
    });
  });

  return {
    submitted: true,
    documents: documents.map((document) => document.type),
    kycStatus: 'SUBMITTED' as const,
    // A PENDING shop only goes live when the reviewer approves — never on submission.
    shopStatus: shop.status,
  };
}

/** Withdraw a submission that is still queued (an approved document cannot be un-sent). */
export async function withdrawKyc(shop: Shop) {
  if (shop.kycStatus === 'APPROVED') throw forbidden('Approved documents cannot be withdrawn — contact support');

  const pending = await prisma.kycDocument.deleteMany({ where: { shopId: shop.id, status: 'SUBMITTED' } });
  await prisma.shop.update({ where: { id: shop.id }, data: { kycStatus: 'NOT_SUBMITTED' } });

  return { removed: pending.count, kycStatus: 'NOT_SUBMITTED' as const };
}

/**
 * `GET /api/admin/kyc/{shopId}` — the reviewer's desk.
 *
 * Each document carries a freshly signed, five-minute URL: a private asset's stored `fileUrl`
 * returns 403 without a signature, so handing that out would give the reviewer a link that
 * looks real and never opens. The raw `publicId` stays on the server.
 *
 * The national ID number and tax PIN appear here and nowhere else in the API. They are needed
 * to match a document against a claim; echoed into a seller session they would be a harvest
 * of identity numbers.
 */
export async function kycCase(shopId: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      isVerified: true,
      kycStatus: true,
      kycBusinessName: true,
      nationalIdNumber: true,
      taxPin: true,
      kycApprovedAt: true,
      createdAt: true,
      phone: true,
      email: true,
      country: { select: { code: true, name: true } },
      baseDistrict: { select: { name: true, code: true } },
      owner: { select: { id: true, name: true, phone: true, email: true, status: true, createdAt: true } },
      _count: { select: { products: true } },
    },
  });
  if (!shop) throw notFound('Shop not found');

  const documents = await prisma.kycDocument.findMany({
    where: { shopId },
    select: {
      id: true, type: true, status: true, publicId: true, fileUrl: true, reviewNote: true,
      reviewedAt: true, expiresAt: true, createdAt: true,
      reviewer: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return {
    shop,
    documents: documents.map((document) => ({
      id: document.id,
      type: document.type,
      status: document.status,
      reviewNote: document.reviewNote,
      reviewedBy: document.reviewer ? { id: document.reviewer.id, name: document.reviewer.name } : null,
      reviewedAt: document.reviewedAt,
      expiresAt: document.expiresAt,
      submittedAt: document.createdAt,
      // Seeded demo documents live under /public and have no Cloudinary asset; anything
      // with an absolute URL is a real upload and needs a short-lived signed view.
      viewUrl: document.fileUrl.startsWith('/')
        ? document.fileUrl
        : signedViewUrl({ publicId: document.publicId, storedUrl: document.fileUrl }),
    })),
  };
}

/**
 * Admin review of one document batch. Approving also lifts the KYC listing gate, so the
 * shop status moves forward with it.
 */
export async function decideKyc(params: {
  shopId: string;
  documentIds: string[];
  decision: 'APPROVE' | 'REJECT';
  note?: string;
  reviewerId: string;
}) {
  const shop = await prisma.shop.findUnique({
    where: { id: params.shopId },
    select: { id: true, kycStatus: true, status: true, ownerId: true, name: true },
  });
  if (!shop) throw notFound('Shop not found');

  const documents = await prisma.kycDocument.findMany({
    where: { id: { in: params.documentIds }, shopId: params.shopId },
    select: { id: true },
  });
  if (documents.length !== params.documentIds.length) throw unprocessable('One of those documents belongs to another shop');

  const status = params.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

  await prisma.$transaction(async (tx) => {
    await tx.kycDocument.updateMany({
      where: { id: { in: documents.map((document) => document.id) } },
      data: { status, reviewerId: params.reviewerId, reviewNote: params.note, reviewedAt: new Date() },
    });

    // The shop-level status is the union of its documents: any rejection sends it back.
    const remaining = await tx.kycDocument.findMany({ where: { shopId: params.shopId }, select: { status: true } });
    const anyRejected = remaining.some((document) => document.status === 'REJECTED');
    const allApproved = remaining.length > 0 && remaining.every((document) => document.status === 'APPROVED');

    await tx.shop.update({
      where: { id: params.shopId },
      data: {
        kycStatus: anyRejected ? 'REJECTED' : allApproved ? 'APPROVED' : 'UNDER_REVIEW',
        ...(allApproved && shop.status === 'PENDING' ? { status: 'ACTIVE', kycApprovedAt: new Date() } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: params.reviewerId,
        action: params.decision === 'APPROVE' ? 'KYC_APPROVE' : 'KYC_REJECT',
        entity: 'SHOP',
        entityId: params.shopId,
        reason: params.note,
        before: { kycStatus: shop.kycStatus, shopStatus: shop.status },
        after: { status, documentIds: documents.map((document) => document.id) },
      },
    });

    await tx.notification.create({
      data: {
        userId: shop.ownerId,
        channel: 'IN_APP',
        status: 'SENT',
        template: params.decision === 'APPROVE' ? 'kyc_approved' : 'kyc_rejected',
        title: params.decision === 'APPROVE' ? 'Documents approved' : 'Documents need another look',
        body:
          params.decision === 'APPROVE'
            ? `${shop.name} can now list in every category.`
            : params.note ?? 'Upload a clearer photo of your ID and resubmit.',
        data: { shopId: params.shopId },
        sentAt: new Date(),
      },
    });
  });

  const settled = await prisma.shop.findUniqueOrThrow({
    where: { id: params.shopId },
    select: { kycStatus: true, status: true },
  });

  return { shopId: params.shopId, kycStatus: settled.kycStatus, shopStatus: settled.status };
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signing an upload is scoped to the caller: a buyer can only write under their own user
 * id, and the KYC prefix is refused unless they own the shop in it. That is what stops one
 * seller from pushing files into another seller's gallery.
 */
export async function signUploadFor(params: { target: UploadTarget; userId: string; shopId?: string }) {
  if (!isCloudinaryConfigured()) throw unprocessable('Image storage is not configured on this deployment');

  let prefix = params.userId;

  if (params.target === 'kyc') {
    if (!params.shopId) throw unprocessable('A KYC upload must name the shop it belongs to');
    const shop = await prisma.shop.findUnique({ where: { id: params.shopId }, select: { ownerId: true } });
    if (!shop) throw notFound('Shop not found');
    if (shop.ownerId !== params.userId) throw forbidden('That shop belongs to another seller');
    prefix = params.shopId;
  }

  if (params.target === 'shop') {
    // Shop media is a seller asset: the folder is the shop, and only its owner signs into it.
    if (!params.shopId) throw unprocessable('A shop image must name the shop it belongs to');
    const shop = await prisma.shop.findUnique({ where: { id: params.shopId }, select: { ownerId: true } });
    if (!shop) throw notFound('Shop not found');
    if (shop.ownerId !== params.userId) throw forbidden('That shop belongs to another seller');
    prefix = params.shopId;
  }

  const signed = signedUploadParams({ target: params.target, prefix });

  return {
    ...signed,
    publicIdHint: buildPublicId({ target: params.target, parts: [prefix, Date.now().toString(36)] }),
    maxSizeMb: params.target === 'kyc' ? 8 : 10,
    accepted: ['image/jpeg', 'image/png', 'image/webp'],
    // The signature covers `folder` + `timestamp` only, so the flags that keep an ID photo out
    // of the public CDN have to be sent by the client alongside it.
    extraFormFields:
      params.target === 'kyc'
        ? { resource_type: 'image', type: 'private', access_mode: 'authenticated' }
        : { resource_type: 'image' },
  };
}

/** Shop logo/banner replacement removes the previous Cloudinary asset. */
export async function setShopMedia(
  shop: Shop,
  params: { kind: 'logo' | 'banner'; url: string; publicId: string },
) {
  const field = params.kind === 'logo' ? { logoUrl: params.url, logoPublicId: params.publicId } : { bannerUrl: params.url, bannerPublicId: params.publicId };
  const previous = params.kind === 'logo' ? shop.logoPublicId : shop.bannerPublicId;

  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: field,
    select: { id: true, logoUrl: true, bannerUrl: true },
  });

  if (previous && previous !== params.publicId) await destroyAsset(previous).catch(() => false);
  return updated;
}

/**
 * Commission shown on the dashboard is the rate the platform will actually take: a
 * negotiated shop override beats the category rate, which beats the platform default.
 */
export async function effectiveCommissionBps(shop: Shop, categoryId?: string): Promise<number> {
  if (shop.commissionRateBps !== null) return Math.round(Number(shop.commissionRateBps));
  if (categoryId) {
    const category = await prisma.category.findUnique({ where: { id: categoryId }, select: { commissionRateBps: true } });
    if (category) return category.commissionRateBps;
  }
  const fallback = await prisma.category.aggregate({ _avg: { commissionRateBps: true }, where: { isActive: true } });
  return Math.round(fallback._avg.commissionRateBps ?? env().PLATFORM_COMMISSION_DEFAULT_BPS);
}
