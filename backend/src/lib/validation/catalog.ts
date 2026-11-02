import { z } from 'zod';
import {
  basisPoints,
  currency,
  isJsonObjectString,
  minorAmount,
  optionalText,
  phone,
  positiveMinorAmount,
  quantity,
  shortText,
} from './common';
import {
  COUNTRY_CODES,
  FULFILMENT_TYPES,
  KYC_DOCUMENT_TYPES,
  PRODUCT_CONDITIONS,
  PRODUCT_SORTS,
  REVIEW_FILTERS,
  REVIEW_STATUSES,
  STOCK_REASONS,
} from './enums';

/** Shop management, catalog (products/variants/images/stock) and social proof. */

export const createShopSchema = z.object({
  name: shortText(80),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{2,59}[a-z0-9]$/, 'Use 4-60 letters, numbers and dashes for the store link')
    .optional(),
  tagline: optionalText(120),
  description: optionalText(2000),
  phone,
  whatsappNumber: phone.optional(),
  email: z.string().trim().email('That email is not valid').max(160).optional(),
  country: z.enum(COUNTRY_CODES).default('UG'),
  baseDistrictId: z.coerce.number().int().positive('Choose the district you dispatch from'),
  streetAddress: optionalText(160),
  defaultFulfilment: z.enum(FULFILMENT_TYPES).default('SELLER_DELIVERY'),
  dispatchSlaHours: z.coerce.number().int().min(1).max(336).default(48),
});

export const updateShopSchema = createShopSchema.partial().omit({ country: true });

export const payoutAccountSchema = z.object({
  provider: z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK']).default('MTN_MOMO'),
  accountNumber: z.string().trim().min(6).max(34, 'Check the mobile money or bank account number'),
  accountName: shortText(80),
  bankName: optionalText(80),
});

export const kycSubmissionSchema = z.object({
  documents: z
    .array(
      z.object({
        type: z.enum(KYC_DOCUMENT_TYPES),
        publicId: shortText(240),
        url: z.string().url('Provide the uploaded document URL'),
        expiresAt: z.string().datetime({ offset: true }).optional(),
      }),
    )
    .min(1, 'Attach at least one document')
    .max(5),
  nationalIdNumber: z
    .string()
    .trim()
    .min(6, 'Enter the number printed on the national ID')
    .max(30)
    .optional(),
  taxPin: optionalText(30),
  businessName: optionalText(120),
});

const variantInputSchema = z.object({
  name: shortText(80),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{3,48}$/, 'SKU is 4-49 characters: letters, numbers and dashes'),
  attributes: z
    .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(60))
    .refine((value) => Object.keys(value).length <= 8, 'A variant can carry at most 8 attributes'),
  priceMinor: positiveMinorAmount,
  compareAtPriceMinor: minorAmount.optional(),
  costPriceMinor: minorAmount.optional(),
  stockQuantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
  weightGrams: z.coerce.number().int().min(1).max(5_000_000).optional(),
  maxQuantityPerOrder: z.coerce.number().int().min(1).max(999).optional(),
  isPrimary: z.boolean().optional(),
});

export const createProductSchema = z
  .object({
    title: shortText(140),
    subtitle: optionalText(160),
    description: z.string().trim().min(30, 'Describe the item in at least 30 characters').max(20_000),
    brand: optionalText(80),
    condition: z.enum(PRODUCT_CONDITIONS).default('NEW'),
    categoryIds: z.array(z.string().min(1)).min(1, 'Pick at least one category').max(5),
    primaryCategoryId: z.string().min(1).optional(),
    fulfilmentType: z.enum(FULFILMENT_TYPES).default('SELLER_DELIVERY'),
    warrantyText: optionalText(200),
    isDigital: z.boolean().default(false),
    weightGrams: z.coerce.number().int().min(1).max(5_000_000).optional(),
    lengthCm: z.coerce.number().positive().max(2000).optional(),
    widthCm: z.coerce.number().positive().max(2000).optional(),
    heightCm: z.coerce.number().positive().max(2000).optional(),
    metaTitle: optionalText(70),
    metaDescription: optionalText(180),
    /** DRAFT lets a seller stage a listing; ACTIVE submits it for moderation. */
    publish: z.boolean().default(false),
    currency: currency.default('UGX'),
    variants: z.array(variantInputSchema).min(1, 'Add at least one price/stock option').max(60),
    images: z
      .array(
        z.object({
          url: z.string().url('Upload the photo first'),
          publicId: shortText(240),
          altText: optionalText(140),
          position: z.coerce.number().int().min(0).max(60).default(0),
          isPrimary: z.boolean().optional(),
        }),
      )
      .max(20, 'Up to 20 photos per listing'),
  })
  .refine(
    (value) => !value.primaryCategoryId || value.categoryIds.includes(value.primaryCategoryId),
    { message: 'The primary category must be one of the selected categories', path: ['primaryCategoryId'] },
  )
  .refine((value) => value.variants.some((variant) => variant.stockQuantity > 0) || !value.publish, {
    message: 'At least one option needs stock before publishing',
    path: ['variants'],
  })
  .refine(
    (value) =>
      value.variants.every(
        (variant) =>
          !variant.compareAtPriceMinor || variant.compareAtPriceMinor > variant.priceMinor,
      ),
    { message: 'A compare-at price must be higher than the selling price', path: ['variants'] },
  );

export const updateProductSchema = z.object({
  title: optionalText(140),
  subtitle: optionalText(160),
  description: z.string().trim().min(30).max(20_000).optional(),
  brand: optionalText(80),
  condition: z.enum(PRODUCT_CONDITIONS).optional(),
  fulfilmentType: z.enum(FULFILMENT_TYPES).optional(),
  warrantyText: optionalText(200),
  weightGrams: z.coerce.number().int().min(1).max(5_000_000).optional(),
  metaTitle: optionalText(70),
  metaDescription: optionalText(180),
  /** ACTIVE (after fixes), ARCHIVED (take down) or DRAFT. */
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']).optional(),
  categoryIds: z.array(z.string().min(1)).min(1).max(5).optional(),
  primaryCategoryId: z.string().min(1).optional(),
});

export const createVariantSchema = variantInputSchema;

export const updateVariantSchema = variantInputSchema
  .partial()
  .extend({ isDisabled: z.boolean().optional() });

/**
 * Taking a listing down and putting it back up is a one-field call, so it gets its own endpoint
 * instead of a full product PATCH that could also rewrite the description on the way past.
 */
export const productStatusSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']),
});

export const stockAdjustmentSchema = z.object({
  /** Signed: +50 restock, -3 shrinkage. Zero is rejected because it logs a useless row. */
  delta: z.coerce.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'Delta cannot be zero'),
  reason: z.enum(STOCK_REASONS).default('MANUAL_ADJUSTMENT'),
  note: optionalText(200),
  /** Re-sending the same key must not move stock twice. */
  idempotencyKey: z
    .string()
    .trim()
    .min(8)
    .max(80)
    .regex(/^[A-Za-z0-9:_-]+$/, 'Use letters, numbers, colon, dash or underscore'),
});

export const productImagesSchema = z.object({
  images: z
    .array(
      z.object({
        url: z.string().url(),
        publicId: shortText(240),
        altText: optionalText(140),
        position: z.coerce.number().int().min(0).max(60).default(0),
        isPrimary: z.boolean().optional(),
        variantId: z.string().min(1).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const productQuerySchema = z.object({
  q: optionalText(120),
  categorySlug: optionalText(120),
  shopSlug: optionalText(120),
  brand: optionalText(80),
  minPriceMinor: z.coerce.number().int().nonnegative().optional(),
  maxPriceMinor: z.coerce.number().int().nonnegative().optional(),
  /** JSONB containment on ProductVariant.attributes, e.g. {"Colour":"Black"} */
  attributes: z
    .string()
    .max(400)
    .optional()
    .refine(isJsonObjectString, 'attributes must be a JSON object, e.g. {"Colour":"Black"}'),
  inStockOnly: z.enum(['true', 'false']).default('true'),
  freeShipping: z.enum(['true', 'false']).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  sort: z.enum(PRODUCT_SORTS).default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(60).default(20),
});

export const reviewSchema = z
  .object({
    targetType: z.enum(['PRODUCT', 'SHOP']),
    productId: z.string().min(1).optional(),
    shopId: z.string().min(1).optional(),
    rating: z.coerce.number().int().min(1).max(5, 'Rating is out of 5'),
    title: optionalText(100),
    body: z.string().trim().min(10, 'Tell buyers what you think in at least 10 characters').max(4000),
    images: z.array(z.string().url()).max(6).default([]),
    orderId: z.string().min(1).optional(),
  })
  .refine(
    (value) => (value.targetType === 'PRODUCT' ? Boolean(value.productId) : Boolean(value.shopId)),
    { message: 'A product review needs productId, a shop review needs shopId', path: ['targetType'] },
  );

/**
 * The review body without the target. Product and shop routes add `targetType` plus the id
 * from the URL, so a buyer posting from one listing cannot aim the review at another.
 */
export const reviewBodySchema = z.object({
  rating: z.coerce.number().int().min(1, 'Pick a star rating').max(5, 'Rating is out of 5'),
  title: optionalText(100),
  body: z.string().trim().min(10, 'Tell buyers what you think in at least 10 characters').max(4000),
  images: z.array(z.string().url()).max(6).default([]),
  orderId: z.string().min(1).optional(),
});

export const reviewQuerySchema = z.object({
  filter: z.enum(REVIEW_FILTERS).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * One signature covers a folder prefix, so a seller uploading twelve photos signs once and
 * picks a unique `public_id` per file under that prefix.
 */
export const uploadSignSchema = z.object({
  target: z.enum(['product', 'shop', 'kyc']),
  shopId: z.string().trim().min(1).max(64).optional(),
});

export const shopMediaSchema = z.object({
  kind: z.enum(['logo', 'banner']),
  url: z.string().url('Upload the image first'),
  publicId: shortText(240),
});

export const vacationSchema = z.object({ on: z.boolean() });

export const questionSchema = z.object({
  body: z.string().trim().min(5, 'Ask in at least 5 characters').max(600),
});

export const answerSchema = z.object({
  body: z.string().trim().min(5, 'Answer in at least 5 characters').max(2000),
});

export const sellerReplySchema = z.object({
  reply: z.string().trim().min(5, 'Say something useful in at least 5 characters').max(1000),
});

export const reviewEditSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: optionalText(100),
  body: z.string().trim().min(10, 'Tell buyers what you think in at least 10 characters').max(4000),
});

export const shopQuerySchema = z.object({
  q: optionalText(120),
  country: z.enum(COUNTRY_CODES).optional(),
  verifiedOnly: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(48).default(12),
});

/** Seller catalog grid: drafts and rejected listings are visible here, nowhere else. */
export const sellerProductQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED']).optional(),
  q: optionalText(120),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const sellerQuestionQuerySchema = z.object({
  unansweredOnly: z.enum(['true', 'false']).default('true'),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

/** Admin review queue: the default is the pile that needs a decision, not everything. */
export const reviewQueueQuerySchema = z.object({
  status: z.enum(REVIEW_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

export const categoryTreeQuerySchema = z.object({
  parentId: optionalText(64),
  includeInactive: z.enum(['true', 'false']).optional(),
});
