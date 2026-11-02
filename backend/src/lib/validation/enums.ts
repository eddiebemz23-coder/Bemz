/**
 * Zod-compatible tuples for the Prisma enums the API accepts.
 * Keeping them here means a route cannot silently accept a status the database will reject.
 */

export const CURRENCIES = ['UGX', 'KES', 'USD'] as const;
export const COUNTRY_CODES = ['UG', 'KE'] as const;
export const USER_ROLES = ['BUYER', 'SELLER', 'ADMIN'] as const;
export const ACCOUNT_STATUSES = ['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED', 'BANNED', 'DELETED'] as const;

export const PRODUCT_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'REJECTED', 'ARCHIVED'] as const;
export const PRODUCT_CONDITIONS = ['NEW', 'USED', 'REFURBISHED'] as const;
export const FULFILMENT_TYPES = [
  'SELLER_DELIVERY',
  'SELLER_SELF_DELIVERY',
  'BUYER_PICKUP',
  'DIGITAL',
] as const;

export const ORDER_STATUSES = [
  'AWAITING_PAYMENT',
  'AWAITING_CONFIRMATION',
  'CONFIRMED',
  'PACKED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
  'FAILED',
] as const;

export const SHIPMENT_STATUSES = [
  'UNASSIGNED',
  'LABEL_CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DELIVERY_HUB',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'FAILED_DELIVERY',
  'RETURNED_TO_SENDER',
] as const;

export const PAYMENT_PROVIDERS = ['MTN_MOMO', 'AIRTEL_MONEY', 'STRIPE_CARD', 'CASH_ON_DELIVERY'] as const;
export const PAYMENT_STATUSES = [
  'INITIATED',
  'PENDING_CUSTOMER',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
] as const;

export const KYC_DOCUMENT_TYPES = [
  'NATIONAL_ID',
  'BUSINESS_REGISTRATION',
  'TAX_PIN',
  'BANK_OR_MOMO_PROOF',
  'FACE_VERIFICATION',
] as const;

export const STOCK_REASONS = [
  'PURCHASE_IN',
  'SALE',
  'CANCELLATION_REVERSAL',
  'RETURN',
  'MANUAL_ADJUSTMENT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
] as const;

export const SELLER_ORDER_TRANSITIONS = ['CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'] as const;

export const PAYOUT_STATUSES = ['REQUESTED', 'APPROVED', 'SENT', 'FAILED', 'REVERSED'] as const;

export const REVIEW_STATUSES = ['PUBLISHED', 'PENDING', 'REMOVED'] as const;

/** Mirrors `AuditEntity` — the filter on the admin audit trail. */
export const AUDIT_ENTITIES = [
  'USER',
  'SHOP',
  'PRODUCT',
  'VARIANT',
  'ORDER',
  'PAYMENT',
  'REVIEW',
  'COUPON',
  'CATEGORY',
  'DELIVERY_ZONE',
  'KYC_DOCUMENT',
  'PAYOUT',
] as const;

export const REVIEW_FILTERS = ['all', 'verified', 'with_photos', '5', '4', '3', '2', '1'] as const;

export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc', 'popular', 'rating'] as const;
