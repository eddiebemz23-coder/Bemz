import { z } from 'zod';
import { basisPoints, minorAmount, optionalText, pagination, phone, positiveMinorAmount, quantity, shortText } from './common';
import {
  AUDIT_ENTITIES,
  ORDER_STATUSES,
  PAYMENT_PROVIDERS,
  PAYOUT_STATUSES,
  SELLER_ORDER_TRANSITIONS,
  SHIPMENT_STATUSES,
} from './enums';

/** Cart, shipping quote, checkout, order management, refunds and payouts. */

export const addToCartSchema = z.object({
  variantId: shortText(64),
  quantity: quantity.default(1),
});

export const updateCartItemSchema = z.object({
  quantity: quantity,
  selected: z.boolean().optional(),
});

export const cartCouponSchema = z.object({
  code: z.string().trim().min(3).max(32).toUpperCase(),
});

/** The basket page posts one flag for "select all" and "select none". */
export const cartSelectAllSchema = z.object({ selected: z.boolean() });

export const shippingQuoteSchema = z.object({
  districtId: z.coerce.number().int().positive('Choose where the parcel is going'),
  addressId: z.string().min(1).optional(),
  /** Lets a product page quote delivery without touching the buyer's basket. */
  variantIds: z.array(z.string().min(1)).max(60).optional(),
});

export const checkoutSchema = z
  .object({
    addressId: z.string().min(1, 'Choose a delivery address'),
    /** Overrides the address district when the buyer collects at a town hub. */
    deliveryDistrictId: z.coerce.number().int().positive().optional(),
    fulfilmentType: z.enum(['SELLER_DELIVERY', 'BUYER_PICKUP']).default('SELLER_DELIVERY'),
    paymentProvider: z.enum(PAYMENT_PROVIDERS),
    /** The MoMo prompt often goes to a different handset than the login number. */
    payerPhone: phone.optional(),
    couponCode: z.string().trim().max(32).toUpperCase().optional(),
    buyerNote: optionalText(500),
    /** A double-tap on "Pay with MoMo" must not create two order groups. */
    idempotencyKey: z
      .string()
      .trim()
      .min(10)
      .max(80)
      .regex(/^[A-Za-z0-9:_-]+$/, 'Use letters, numbers, colon, dash or underscore'),
  })
  .superRefine((value, ctx) => {
    const needsPayerPhone = value.paymentProvider === 'MTN_MOMO' || value.paymentProvider === 'AIRTEL_MONEY';
    if (needsPayerPhone && !value.payerPhone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payerPhone'],
        message: 'Enter the mobile money number that will be prompted for the PIN',
      });
    }
  });

export const orderListQuerySchema = pagination.extend({
  status: z.enum(ORDER_STATUSES).optional(),
  shipmentStatus: z.enum(SHIPMENT_STATUSES).optional(),
  /** Sellers can filter their own queue; buyers cannot pass this. */
  shopId: optionalText(64),
  q: optionalText(64),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export const sellerOrderTransitionSchema = z.object({
  to: z.enum(SELLER_ORDER_TRANSITIONS),
  note: optionalText(300),
  trackingNumber: optionalText(40),
  courierName: optionalText(80),
  /** Packing a parcel consumes the reserved stock, so the transition is explicit. */
  consumedStock: z.boolean().default(true),
});

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(5, 'Tell us why the order is being cancelled').max(300),
  /** Sellers who cancel before dispatch get the units back; after dispatch they do not. */
  restock: z.boolean().default(true),
});

/** The SMS code that releases a cash-on-delivery order into the seller's queue. */
export const orderConfirmSchema = z.object({
  code: z.string().trim().regex(/^[0-9]{6}$/, 'Enter the 6-digit code from the SMS'),
});

/**
 * Retrying a failed prompt often means a different handset — the buyer's phone is in another
 * room, so the number they are holding is the one that must be asked for the PIN.
 */
export const retryPaymentSchema = z.object({
  payerPhone: phone.optional(),
});

export const refundSchema = z.object({
  amountMinor: minorAmount.refine((value) => value > 0, 'Refund amount must be greater than zero'),
  reason: z.string().trim().min(5).max(300),
});

export const payoutRequestSchema = z.object({
  periodStart: z.string().datetime({ offset: true }),
  periodEnd: z.string().datetime({ offset: true }),
  accountNumber: phone,
  accountName: shortText(80),
});

export const adminModerationSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: optionalText(400),
});

export const adminShopStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
  reason: optionalText(400),
  verified: z.boolean().optional(),
});

export const adminUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']),
  reason: optionalText(400),
});

export const adminKycDecisionSchema = z.object({
  documentIds: z.array(z.string().min(1)).min(1).max(6),
  decision: z.enum(['APPROVE', 'REJECT']),
  note: optionalText(400),
});

export const districtQuerySchema = z.object({
  country: z.enum(['UG', 'KE']).optional(),
  q: optionalText(60),
  majorOnly: z.enum(['true', 'false']).optional(),
});

/** A payout window is dates only — the amount is always recomputed from delivered orders. */
export const payoutWindowSchema = payoutRequestSchema.pick({ periodStart: true, periodEnd: true });

export const payoutListQuerySchema = pagination.extend({
  status: z.enum(PAYOUT_STATUSES).optional(),
});

export const payoutSentSchema = z.object({
  /** The operator portal's own transfer reference, unique so it cannot be booked twice. */
  providerReference: z.string().trim().min(4).max(80),
});

export const payoutReasonSchema = z.object({
  reason: z.string().trim().min(5, 'Say why, so the seller knows what to fix').max(300),
});

/** Approving needs no explanation; the note is where the operator's own reference goes. */
export const payoutNoteSchema = z.object({ note: optionalText(300) });

export const adminReviewModerationSchema = z.object({
  decision: z.enum(['PUBLISH', 'REMOVE', 'HOLD']),
  reason: optionalText(400),
});

export const wishlistAddSchema = z.object({ productId: shortText(64) });

export const adminMetricsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export const auditQuerySchema = pagination.extend({
  entity: z.enum(AUDIT_ENTITIES).optional(),
  entityId: optionalText(64),
  actorId: optionalText(64),
});

export const payoutLedgerQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  status: z.enum(PAYOUT_STATUSES).optional(),
});

/**
 * Category edits change the commission the platform earns and the KYC gate that protects
 * counterfeit-heavy lines, so they are admin-only and audited field by field.
 */
export const adminCategoryPatchSchema = z
  .object({
    name: shortText(80).optional(),
    isActive: z.boolean().optional(),
    commissionRateBps: basisPoints.optional(),
    requiresKyc: z.boolean().optional(),
    sortOrder: z.coerce.number().int().min(0).max(9999).optional(),
    imageUrl: z.string().url().nullable().optional(),
    icon: optionalText(60),
    description: optionalText(500),
    parentId: z.string().min(1).max(64).nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), 'Send at least one field to change');

/** Repricing delivery: an order snapshots its own fee, so this only affects future checkouts. */
export const adminZonePatchSchema = z
  .object({
    baseFeeMinor: positiveMinorAmount.optional(),
    perKgFeeMinor: minorAmount.optional(),
    freeOverMinor: minorAmount.nullable().optional(),
    estimatedDaysMin: z.coerce.number().int().min(0).max(120).optional(),
    estimatedDaysMax: z.coerce.number().int().min(1).max(120).optional(),
    cashOnDeliveryAllowed: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), 'Send at least one field to change');

export const adminDistrictZoneSchema = z.object({
  districtId: z.coerce.number().int().positive('Pick the town'),
  zoneId: z.coerce.number().int().positive('Pick the delivery zone it belongs to'),
});
