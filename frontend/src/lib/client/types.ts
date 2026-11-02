import type { CurrencyCode } from '@/lib/money';

/**
 * Shapes the browser sees. These mirror the API responses, which means every `Date` has
 * already been flattened to an ISO string by `JSON.stringify` — and every `bigint` has been
 * narrowed to a number by the service projections. `Timestamp` is deliberately `string | Date`
 * because a server component reads the same fields straight off the service layer, where they
 * are still real `Date`s.
 */
export type Timestamp = string | Date;

export type OrderStatus =
  | 'AWAITING_PAYMENT'
  | 'AWAITING_CONFIRMATION'
  | 'CONFIRMED'
  | 'PACKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'FAILED';

export type PaymentProvider = 'MTN_MOMO' | 'AIRTEL_MONEY' | 'STRIPE_CARD' | 'CASH_ON_DELIVERY';
export type PaymentStatus =
  | 'INITIATED'
  | 'PENDING_CUSTOMER'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type FulfilmentType = 'SELLER_DELIVERY' | 'SELLER_SELF_DELIVERY' | 'BUYER_PICKUP' | 'DIGITAL';
export type ProductStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'REJECTED' | 'ARCHIVED';
export type ProductCondition = 'NEW' | 'USED' | 'REFURBISHED';
export type ShopStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
export type KycStatus = 'NOT_SUBMITTED' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
export type UserRole = 'BUYER' | 'SELLER' | 'ADMIN';

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
  hasMore?: boolean;
}

export interface ShopCard {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  tagline: string | null;
  description: string | null;
  /** A business line, disclosed on the shop page itself. */
  phone: string | null;
  isVerified: boolean;
  isOfficialStore: boolean;
  ratingAvg: number | null;
  ratingCount: number;
  totalSalesCount: number;
  followers: number;
  vacationMode: boolean;
  defaultFulfilment: FulfilmentType;
  dispatchSlaHours: number;
  country: { code: string; name: string; currency: CurrencyCode };
  basedIn: {
    id: number;
    name: string;
    code: string;
    zone: string | null;
    estimatedDaysMin: number | null;
    estimatedDaysMax: number | null;
  } | null;
  productCount: number;
  since: Timestamp;
}

export interface ProductListItem {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  brand: string | null;
  condition: ProductCondition;
  currency: CurrencyCode;
  startingPriceMinor: number | null;
  compareAtPriceMinor: number | null;
  discountPct: number | null;
  ratingAvg: number | null;
  ratingCount: number;
  soldCount: number;
  availableStock: number;
  imageUrl: string | null;
  thumbImageUrl: string | null;
  secondImageUrl: string | null;
  fulfilmentType: FulfilmentType;
  isDigital: boolean;
  createdAt: Timestamp;
  shop: Pick<ShopCard, 'id' | 'name' | 'slug' | 'isVerified'> & { country: string };
  categories: { name: string; slug: string }[];
}

export interface ProductVariantPublic {
  id: string;
  sku: string;
  name: string;
  attributes: Record<string, unknown>;
  priceMinor: number;
  compareAtPriceMinor: number | null;
  currency: CurrencyCode;
  isPrimary: boolean;
  availableStock: number;
  maxQuantityPerOrder: number | null;
  weightGrams: number | null;
  images: { url: string; thumbUrl: string; altText: string | null }[];
}

export interface PublicProduct {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string;
  brand: string | null;
  condition: ProductCondition;
  status: ProductStatus;
  currency: CurrencyCode;
  startingPriceMinor: number | null;
  discountPct: number | null;
  warrantyText: string | null;
  fulfilmentType: FulfilmentType;
  isDigital: boolean;
  weightGrams: number | null;
  ratingAvg: number | null;
  ratingCount: number;
  soldCount: number;
  viewsCount: number;
  wishlistsCount: number;
  createdAt: Timestamp;
  purchasable: boolean;
  images: { id: string; url: string; thumbUrl: string; altText: string | null; position: number; isPrimary: boolean }[];
  variants: ProductVariantPublic[];
  availableStock: number;
  facets: Record<string, string[]>;
  primaryCategory: { id: string; name: string; slug: string; path: string } | null;
  categories: { name: string; slug: string; isPrimary: boolean }[];
  shop: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    isVerified: boolean;
    isOfficialStore: boolean;
    ratingAvg: number | null;
    ratingCount: number;
    totalSalesCount: number;
    dispatchSlaHours: number;
    defaultFulfilment: FulfilmentType;
    country: { code: string; name: string; currency: CurrencyCode; taxRateBps: number; taxLabel: string };
    fromDistrict: string | null;
    deliveryZone: {
      name: string;
      code: string;
      baseFeeMinor: number;
      freeOverMinor: number | null;
      estimatedDaysMin: number;
      estimatedDaysMax: number;
    } | null;
    isOpen: boolean;
    contactPhone: string | null;
  };
  questions: {
    id: string;
    body: string;
    askedBy: string;
    askedAt: Timestamp;
    answers: { id: string; body: string; by: string; isFromSeller: boolean; at: Timestamp }[];
  }[];
}

export interface ReviewCard {
  id: string;
  targetType: 'PRODUCT' | 'SHOP';
  productId: string | null;
  shopId: string | null;
  rating: number;
  title: string | null;
  body: string;
  images: string[];
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  sellerReply: string | null;
  sellerRepliedAt: Timestamp | null;
  createdAt: Timestamp;
  author: { id: string; displayName: string; avatarUrl: string | null };
  votedHelpful: boolean;
}

export interface RatingBucket {
  rating: number;
  count: number;
}

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  imageUrl: string | null;
  commissionRateBps: number | null;
  requiresKyc: boolean;
  productCount?: number;
  children?: CategoryNode[];
}

export interface CountryRow {
  code: string;
  name: string;
  currency: CurrencyCode;
  phonePrefix: string;
  taxRateBps: number;
  taxLabel: string;
  _count: { districts: number; deliveryZones: number; shops: number };
}

export interface DistrictZone {
  id: number;
  name: string;
  code: string;
  baseFeeMinor: number;
  perKgFeeMinor: number;
  freeOverMinor: number | null;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  cashOnDeliveryAllowed: boolean;
  isActive: boolean;
}

export interface DistrictRow {
  id: number;
  name: string;
  code: string;
  isMajor: boolean;
  region: string | null;
  country: string;
  currency: CurrencyCode;
  /** `null` means "we do not deliver here yet" — the option must be disabled, not hidden. */
  zone: DistrictZone | null;
}

export interface DistrictList {
  deliverable: DistrictRow[];
  unreachable: { id: number; name: string; code: string; country: string }[];
}

export interface ZoneRow {
  id: number;
  code: string;
  name: string;
  country: string;
  currency: CurrencyCode;
  baseFeeMinor: number;
  perKgFeeMinor: number;
  freeOverMinor: number | null;
  estimatedDays: { min: number; max: number };
  cashOnDeliveryAllowed: boolean;
  isActive: boolean;
  districtCount: number;
}

export interface CartLine {
  itemId: string;
  variantId: string;
  productId: string;
  productSlug: string;
  productTitle: string;
  variantName: string;
  sku: string;
  imageUrl: string | null;
  shopId: string;
  shopName: string;
  shopSlug: string;
  quantity: number;
  selected: boolean;
  currency: CurrencyCode;
  unitPriceMinor: number;
  snapshotPriceMinor: number;
  priceChanged: boolean;
  lineTotalMinor: number;
  availableStock: number;
  maxQuantityPerOrder: number | null;
  isOutOfStock: boolean;
  exceedsStock: boolean;
  exceedsMaxPerOrder: boolean;
}

export interface CartView {
  cartId: string;
  isGuest: boolean;
  currency: CurrencyCode | null;
  couponCode: string | null;
  itemCount: number;
  selectedCount: number;
  subtotalMinor: number;
  selectedSubtotalMinor: number;
  blockedLines: number;
  lines: CartLine[];
}

/** Mirrors the body of `POST /api/cart/quote` — commission and zone ids stay server-side. */
export interface QuoteShopBasket {
  shopId: string;
  shopName: string;
  currency: CurrencyCode;
  lines: {
    variantId: string;
    productId: string;
    productTitle: string;
    variantName: string;
    sku: string;
    imageUrl: string | null;
    unitPriceMinor: number;
    currency: CurrencyCode;
    quantity: number;
    lineTotalMinor: number;
    availableStock: number;
  }[];
  subtotalMinor: number;
  discountMinor: number;
  shippingFeeMinor: number;
  vatIncludedMinor: number;
  totalMinor: number;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  zoneName: string;
  cashOnDeliveryAllowed: boolean;
}

export interface BasketQuote {
  currency: CurrencyCode;
  districtId: number;
  districtName: string;
  zone: { id: number; code: string; name: string };
  baskets: QuoteShopBasket[];
  subtotalMinor: number;
  discountMinor: number;
  shippingFeeMinor: number;
  vatIncludedMinor: number;
  totalMinor: number;
  freeShippingSavedMinor: number;
  couponCode: string | null;
  couponMessage: string | null;
  cashOnDeliveryAvailable: boolean;
}

export interface AddressView {
  id: string;
  label: string | null;
  recipientName: string;
  recipientPhone: string;
  alternativePhone: string | null;
  districtId: number;
  districtName: string;
  districtCode: string;
  isMajorDistrict: boolean;
  countryId: number;
  countryCode: 'UG' | 'KE';
  countryCurrency: CurrencyCode;
  zoneId: number | null;
  zoneName: string | null;
  zoneCode: string | null;
  cashOnDeliveryAllowed: boolean;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  subcounty: string | null;
  parish: string | null;
  village: string | null;
  streetAddress: string | null;
  nearestLandmark: string | null;
  deliveryNote: string | null;
  lat: number | null;
  lng: number | null;
  pinCode: string | null;
  isDefault: boolean;
  createdAt: Timestamp;
}

export interface PaymentProviderOption {
  provider: PaymentProvider;
  label: string;
  available: boolean;
  /** Only MTN and Airtel need the handset that will be shown the PIN prompt. */
  needsPhone: boolean;
  currency: CurrencyCode;
  suggested: boolean;
}

export interface ProviderList {
  currency: CurrencyCode;
  providers: PaymentProviderOption[];
  cashOnDeliveryEnabledGlobally: boolean;
  guidance: string;
}

export interface CheckoutResult {
  groupId: string;
  groupReference: string;
  currency: CurrencyCode;
  totalMinor: number;
  orders: {
    id: string;
    orderNumber: string;
    shopName: string;
    status: OrderStatus;
    totalMinor: number;
    itemCount: number;
    trackingNumber: string;
    expiresAt: Timestamp;
  }[];
  payments: { id: string; externalId: string; provider: PaymentProvider; status: string; amountMinor: number }[];
  instruction: string;
  redirectUrl: string | null;
  replayed: boolean;
}

export interface OrderSummary {
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
  placedAt: Timestamp;
  expiresAt: Timestamp | null;
  trackingNumber: string | null;
  courierName: string | null;
  shipmentStatus: string;
  districtName: string | null;
  recipientName: string | null;
  itemCount: number;
}

export interface OrderDetail extends OrderSummary {
  items: {
    id: string;
    variantId: string;
    productId: string;
    /** `null` when the listing has since been deleted, so the "rate this item" link can be dropped. */
    productSlug: string | null;
    productTitle: string;
    variantName: string;
    sku: string;
    imageUrl: string | null;
    unitPriceMinor: number;
    quantity: number;
    discountMinor: number;
    totalMinor: number;
    deliveredQuantity: number;
    returnedQuantity: number;
  }[];
  address: Record<string, unknown> | null;
  statusHistory: { id: string; from: string | null; to: string; note: string | null; createdAt: Timestamp }[];
  payments: {
    id: string;
    provider: PaymentProvider;
    status: PaymentStatus;
    amountMinor: number;
    externalId: string;
    payerPhone: string | null;
    completedAt: Timestamp | null;
  }[];
  refunds: { id: string; amountMinor: number; status: string; reason: string | null; createdAt: Timestamp }[];
  deliveryNote: string | null;
  buyerNote: string | null;
  sellerNote: string | null;
  cancellationReason: string | null;
  estimatedDeliveryAt: Timestamp | null;
  canBuyerCancel: boolean;
  canBuyerConfirm: boolean;
  canReview: boolean;
  allowedSellerTransitions: string[];
}

export interface PaymentView {
  id: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amountMinor: number;
  currency: CurrencyCode;
  externalId: string | null;
  providerReference: string | null;
  payerPhone: string | null;
  requestedAt: Timestamp | null;
  completedAt: Timestamp | null;
  expiresAt: Timestamp | null;
  failureCode: string | null;
  failureReason: string | null;
  retryCount: number;
  createdAt: Timestamp;
}

export interface SellerProductRow {
  id: string;
  slug: string;
  title: string;
  status: ProductStatus;
  currency: CurrencyCode;
  brand: string | null;
  condition: ProductCondition;
  fulfilmentType: FulfilmentType;
  rejectionReason: string | null;
  startingPriceMinor: number | null;
  soldCount: number;
  viewsCount: number;
  ratingCount: number;
  imageUrl: string | null;
  categories: { id: string; name: string; requiresKyc: boolean }[];
  variants: {
    id: string;
    sku: string;
    name: string;
    priceMinor: number;
    compareAtPriceMinor: number | null;
    costPriceMinor: number | null;
    stockQuantity: number;
    reservedQuantity: number;
    available: number;
    lowStockThreshold: number | null;
    isDisabled: boolean;
    isPrimary: boolean;
  }[];
  updatedAt: Timestamp;
  createdAt: Timestamp;
}

export interface SellerShopOverview {
  shop: {
    id: string;
    name: string;
    slug: string;
    status: ShopStatus;
    kycStatus: KycStatus;
    isVerified: boolean;
    vacationMode: boolean;
    logoUrl: string | null;
    bannerUrl: string | null;
    tagline: string | null;
    description: string | null;
    phone: string | null;
    whatsappNumber: string | null;
    email: string | null;
    streetAddress: string | null;
    defaultFulfilment: FulfilmentType;
    dispatchSlaHours: number;
    commissionRateBps: number | null;
    ratingAvg: number | null;
    ratingCount: number;
    followers: number;
    totalSalesCount: number;
    totalSalesMinor: number;
    currency: CurrencyCode;
    country: { code: string; name: string; taxRateBps: number; taxLabel: string };
    basedIn: {
      id: number;
      name: string;
      zone: string | null;
      zoneBaseFeeMinor: number | null;
      freeOverMinor: number | null;
    } | null;
    payoutAccount: { id: string; provider: string; accountNumber: string; accountName: string; isVerified: boolean } | null;
    kyc: {
      status: KycStatus;
      documents: { id: string; type: string; status: string; reviewNote: string | null; submittedAt: Timestamp }[];
    };
  };
  counts: {
    ordersByStatus: Record<string, number>;
    productsByStatus: Record<string, number>;
    openOrders: number;
    outOfStockVariants: number;
    grossSalesMinor: number;
    platformFeesMinor: number;
    shippingCollectedMinor: number;
  };
}

export interface PayoutSummary {
  currency: CurrencyCode;
  settlementDelayDays: number;
  minimumMinor: number;
  minimumLabel: string;
  windowStart: Timestamp;
  windowEnd: Timestamp;
  clearedOrderCount: number;
  availableMinor: number;
  availableLabel: string;
  requestedMinor: number;
  withdrawableMinor: number;
  clearingMinor: number;
  clearingOrderCount: number;
  cashWithRidersMinor: number;
  cashParcelCount: number;
  lifetimeWithdrawnMinor: number;
  payoutCount: number;
  account: {
    id: string;
    provider: string;
    accountNumber: string;
    accountName: string;
    bankName: string | null;
    isVerified: boolean;
  } | null;
  blockers: string[];
}

export interface AdminMetrics {
  window: { days: number; since: Timestamp; to: Timestamp; previousSince: Timestamp };
  currency: CurrencyCode;
  commissionBpsDefault: number;
  gmv: {
    minor: number;
    previousMinor: number;
    deltaPct: number | null;
    orderCount: number;
    averageOrderMinor: number;
    platformFeeMinor: number;
    shippingMinor: number;
    discountsMinor: number;
  };
  ordersByStatus: { status: OrderStatus; count: number }[];
  cancellations: { count: number; ratePct: number };
  refunds: { count: number; minor: number };
  growth: { newShops: number; newBuyers: number };
  paymentMix: { provider: PaymentProvider; count: number; minor: number }[];
  topShops: { id: string; name: string; slug: string; orderCount: number; gmvMinor: number }[];
  topProducts: { id: string; title: string; slug: string; shopSlug: string; sold: number; minor: number }[];
  alerts: { expiredUnpaidOrders: number; shopsAwaitingKyc: number; productsAwaitingModeration: number };
}

export interface ModerationQueues {
  products: {
    id: string;
    title: string;
    slug: string;
    startingPriceMinor: number | null;
    currency: CurrencyCode;
    createdAt: Timestamp;
    imageUrl: string | null;
    shop: { id: string; name: string; slug: string; kycStatus: KycStatus; totalSalesCount: number };
    primaryCategory: { name: string; requiresKyc: boolean } | null;
  }[];
  shops: {
    id: string;
    name: string;
    slug: string;
    createdAt: Timestamp;
    kycStatus: KycStatus;
    country: { code: string; name: string };
    baseDistrict: { name: string } | null;
    owner: { id: string; name: string | null; phone: string | null; phoneVerified: boolean };
    _count: { products: number };
  }[];
  kycDocuments: {
    id: string;
    type: string;
    createdAt: Timestamp;
    expiresAt: Timestamp | null;
    shopId: string;
    shop: { id: string; name: string; slug: string; nationalIdNumber: string | null; taxPin: string | null };
  }[];
  pendingReviewCount: number;
}

export interface PayoutRow {
  id: string;
  shopId: string;
  amountMinor: number;
  currency: CurrencyCode;
  status: 'REQUESTED' | 'APPROVED' | 'SENT' | 'FAILED' | 'REVERSED';
  periodStart: Timestamp;
  periodEnd: Timestamp;
  providerReference: string | null;
  failureReason: string | null;
  processedAt: Timestamp | null;
  processedBy: string | null;
  createdAt: Timestamp;
  account: { provider: string; accountNumber: string; accountName: string; bankName: string | null } | null;
  shop?: { id: string; name: string; slug: string; kycStatus: KycStatus; status: ShopStatus };
}

export interface PayoutQueue {
  items: PayoutRow[];
  total: number;
  page: number;
  perPage: number;
  hasMore: boolean;
  openTotalMinor: number;
  openCount: number;
}

export interface AuditRow {
  id: string;
  createdAt: Timestamp;
  action: string;
  entity: string;
  entityId: string | null;
  reason: string | null;
  actor: { id: string; name: string | null; role: UserRole } | null;
  before: unknown;
  after: unknown;
}

export interface MeProfile {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: UserRole;
  avatarUrl: string | null;
  preferredCurrency: CurrencyCode;
  languageCode: string;
  phoneVerified: Timestamp | null;
  createdAt: Timestamp;
  gender: string | null;
  marketingOptIn: boolean;
  whatsappOptIn: boolean;
  dateOfBirth: Timestamp | null;
  country: { code: string; name: string; currency: CurrencyCode; phonePrefix: string; taxLabel: string } | null;
  shopsOwned: {
    id: string;
    name: string;
    slug: string;
    status: ShopStatus;
    kycStatus: KycStatus;
    isVerified: boolean;
    logoUrl: string | null;
    ratingAvg: number | null;
    ratingCount: number;
    vacationMode: boolean;
    commissionRateBps: number | null;
    payoutAccount: { id: string; provider: string; accountNumber: string; isVerified: boolean } | null;
  }[];
  primaryAddress: { id: string; label: string | null; nearestLandmark: string | null; district: { name: string } | null } | null;
  hasPassword: boolean;
  stats: { orders: number; reviews: number; wishlistEntries: number };
}

export interface PendingReviewTarget {
  orderId: string;
  productId: string;
  title: string;
  imageUrl: string | null;
  variantName: string;
  deliveredAt: Timestamp | null;
  shop: { id: string; name: string; slug: string; logoUrl: string | null };
}

export interface UploadTicket {
  cloudName: string;
  apiKey: string;
  preset: string;
  folder: string;
  timestamp: number;
  signature: string;
  endpoint: string;
  publicIdHint: string;
  maxSizeMb: number;
  accepted: string[];
  extraFormFields: Record<string, string>;
}

export interface UploadedAsset {
  url: string;
  publicId: string;
  width: number;
  format: string;
}

export interface OrderGroupReceipt {
  id: string;
  reference: string;
  currency: CurrencyCode;
  totalMinor: number;
  createdAt: Timestamp;
  orders: {
    id: string;
    orderNumber: string;
    status: OrderStatus;
    shop: { id: string; name: string; slug: string };
    subtotalMinor: number;
    discountMinor: number;
    shippingFeeMinor: number;
    totalMinor: number;
    trackingNumber: string | null;
    expiresAt: Timestamp | null;
    itemCount: number;
    items: { id: string; productTitle: string; variantName: string; imageUrl: string | null; quantity: number; totalMinor: number }[];
    payments: { id: string; provider: PaymentProvider; status: PaymentStatus; amountMinor: number }[];
  }[];
}
