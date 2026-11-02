import 'server-only';
import type { z } from 'zod';
import { Prisma, prisma, type CurrencyCode, type ShippingAddress, type UserRole } from '../prisma';
import { hashPassword, verifyPassword, assessPasswordStrength } from '../auth/password';
import { normalisePhone, tryNormalisePhone } from '../phone';
import { conflict, forbidden, notFound, unprocessable } from '../http';
import { uniqueSlug, shopSlugTaken } from '../slug';
import type { registerSchema, updateProfileSchema, shippingAddressSchema, updateAddressSchema } from '../validation/auth';
import type { payoutAccountSchema } from '../validation/catalog';

/**
 * Account, profile and address book operations shared by the API routes.
 *
 * Everything here keys off the E.164 phone number, because in Uganda and Kenya the phone
 * is the account: email is optional, and a buyer who loses a SIM can still be recognised
 * by support from their number.
 */

export type RegisterInput = z.infer<typeof registerSchema>;
export type ProfilePatch = z.infer<typeof updateProfileSchema>;
export type AddressInput = z.infer<typeof shippingAddressSchema>;
export type AddressPatch = z.infer<typeof updateAddressSchema>;

export type PublicUser = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: UserRole;
  avatarUrl: string | null;
  preferredCurrency: CurrencyCode;
  languageCode: string;
  phoneVerified: Date | null;
  createdAt: Date;
};

const publicUserSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  role: true,
  avatarUrl: true,
  preferredCurrency: true,
  languageCode: true,
  phoneVerified: true,
  createdAt: true,
} as const;

/** The seller dashboard needs the shop shell immediately after registration. */
export type RegisterResult = {
  user: PublicUser;
  shop: { id: string; name: string; slug: string; status: string } | null;
  /** OTP accounts have no password; the UI shows "set a password" instead of "change it". */
  hasPassword: boolean;
};

export async function registerAccount(input: RegisterInput): Promise<RegisterResult> {
  const phone = normalisePhone(input.phone, input.country);

  const existing = await prisma.user.findUnique({ where: { phone: phone.e164 }, select: { id: true } });
  if (existing) {
    throw conflict('An account already uses this phone number — sign in with a code instead');
  }
  if (input.email) {
    const emailTaken = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (emailTaken) throw conflict('That email is already registered');
  }

  if (input.password) {
    const strength = assessPasswordStrength(input.password);
    if (!strength.ok) throw unprocessable(strength.reason ?? 'Password is too weak');
  }

  const country = await prisma.country.findUnique({ where: { code: phone.region } });
  if (!country) throw unprocessable('We do not operate in that country yet');

  const user = await prisma.user.create({
    data: {
      name: input.name,
      phone: phone.e164,
      // A password form has not proved the buyer controls the SIM; the first OTP login does.
      phoneVerified: null,
      email: input.email,
      emailVerified: input.email ? new Date() : null,
      passwordHash: input.password ? await hashPassword(input.password) : null,
      role: input.asSeller ? 'SELLER' : 'BUYER',
      countryId: country.id,
      preferredCurrency: country.currency,
      lastLoginAt: new Date(),
    },
    select: publicUserSelect,
  });

  let shop: RegisterResult['shop'] = null;
  if (input.asSeller && input.shopName) {
    shop = await createShopShell({
      userId: user.id,
      name: input.shopName,
      phone: phone.e164,
      countryId: country.id,
    });
  }

  return { user, shop, hasPassword: Boolean(input.password) };
}

/**
 * A seller registration only needs a name to start; the district, KYC and payout
 * details are filled in on the dashboard, which is why `status` stays PENDING.
 */
async function createShopShell(params: {
  userId: string;
  name: string;
  phone: string;
  countryId: number;
  baseDistrictId?: number;
}) {
  const slug = await uniqueSlug(params.name, shopSlugTaken);
  return prisma.shop.create({
    data: {
      ownerId: params.userId,
      name: params.name,
      slug,
      phone: params.phone,
      countryId: params.countryId,
      baseDistrictId: params.baseDistrictId,
      status: 'PENDING',
    },
    select: { id: true, name: true, slug: true, status: true },
  });
}

/** `GET /api/me` — profile plus the counts the header and dashboards need. */
export async function loadMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...publicUserSelect,
      gender: true,
      marketingOptIn: true,
      whatsappOptIn: true,
      dateOfBirth: true,
      passwordHash: true,
      country: { select: { code: true, name: true, currency: true, phonePrefix: true, taxLabel: true } },
      shopsOwned: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          kycStatus: true,
          isVerified: true,
          logoUrl: true,
          ratingAvg: true,
          ratingCount: true,
          vacationMode: true,
          commissionRateBps: true,
          payoutAccount: { select: { id: true, provider: true, accountNumber: true, isVerified: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      addresses: {
        where: { archivedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        take: 1,
        select: { id: true, label: true, nearestLandmark: true, district: { select: { name: true } } },
      },
      _count: { select: { orders: true, reviews: true, wishlistEntries: true } },
    },
  });

  if (!user) throw notFound('Account not found');

  const { passwordHash, addresses, _count, ...profile } = user;
  return {
    ...profile,
    primaryAddress: addresses[0] ?? null,
    hasPassword: Boolean(passwordHash),
    stats: _count,
  };
}

export async function updateProfile(userId: string, patch: ProfilePatch) {
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.gender !== undefined) data.gender = patch.gender;
  if (patch.preferredCurrency !== undefined) data.preferredCurrency = patch.preferredCurrency;
  if (patch.languageCode !== undefined) data.languageCode = patch.languageCode;
  if (patch.marketingOptIn !== undefined) data.marketingOptIn = patch.marketingOptIn;
  if (patch.whatsappOptIn !== undefined) data.whatsappOptIn = patch.whatsappOptIn;

  if (patch.email !== undefined) {
    const taken = await prisma.user.findFirst({
      where: { email: patch.email, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) throw conflict('That email belongs to another account');
    data.email = patch.email;
    // We cannot verify an email without a link, but changing it clears the old proof.
    data.emailVerified = null;
  }

  if (Object.keys(data).length === 0) throw unprocessable('Nothing to update');

  return prisma.user.update({ where: { id: userId }, data, select: publicUserSelect });
}

/**
 * Passwords are an opt-in second factor over OTP, mostly for admin staff and shops that
 * share a login across staff phones. Changing one always requires the current password,
 * so an XSS payload holding a valid session cookie cannot lock the owner out.
 */
export async function changePassword(userId: string, params: { currentPassword?: string; newPassword: string }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) throw notFound('Account not found');

  // An account that already has a password must prove it, so a hijacked session cookie
  // cannot lock the owner out. Setting the first one needs no proof: this request only
  // happens behind requireUser, and the session came from an SMS code they just entered.
  if (user.passwordHash) {
    const ok = await verifyPassword(params.currentPassword ?? '', user.passwordHash);
    if (!ok) throw forbidden('Your current password is not correct');
  }

  const strength = assessPasswordStrength(params.newPassword);
  if (!strength.ok) throw unprocessable(strength.reason ?? 'Password is too weak');

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(params.newPassword), failedLoginCount: 0, lockedUntil: null },
  });

  return { hasPassword: true };
}

/** A seller who decides OTP is enough can drop the password and rely on SMS. */
export async function removePassword(userId: string, params: { currentPassword: string }) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user?.passwordHash) throw unprocessable('This account has no password to remove');

  const ok = await verifyPassword(params.currentPassword, user.passwordHash);
  if (!ok) throw forbidden('Your current password is not correct');

  await prisma.user.update({ where: { id: userId }, data: { passwordHash: null } });
  return { hasPassword: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESS BOOK
// ─────────────────────────────────────────────────────────────────────────────

export type AddressView = {
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
  createdAt: Date;
};

const addressInclude = {
  district: {
    select: {
      id: true,
      name: true,
      code: true,
      isMajor: true,
      countryId: true,
      country: { select: { code: true, name: true, currency: true } },
      zone: {
        select: { id: true, name: true, code: true, cashOnDeliveryAllowed: true, estimatedDaysMin: true, estimatedDaysMax: true },
      },
    },
  },
} as const;

/** The exact shape the queries above return, so no view mapper needs a cast. */
type AddressRow = Prisma.ShippingAddressGetPayload<{ include: typeof addressInclude }>;

/**
 * The checkout page reads the delivery zone straight off the address, so the view joins
 * it: buyers need to see "Kampala Metro — 1-2 days" before they commit to an order.
 */
export function toAddressView(address: AddressRow): AddressView {
  const zone = address.district.zone;
  return {
    id: address.id,
    label: address.label,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    alternativePhone: address.alternativePhone,
    districtId: address.districtId,
    districtName: address.district.name,
    districtCode: address.district.code,
    isMajorDistrict: address.district.isMajor,
    countryId: address.district.countryId,
    countryCode: address.district.country.code,
    countryCurrency: address.district.country.currency,
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? null,
    zoneCode: zone?.code ?? null,
    cashOnDeliveryAllowed: zone?.cashOnDeliveryAllowed ?? false,
    estimatedDaysMin: zone?.estimatedDaysMin ?? 3,
    estimatedDaysMax: zone?.estimatedDaysMax ?? 7,
    subcounty: address.subcounty,
    parish: address.parish,
    village: address.village,
    streetAddress: address.streetAddress,
    nearestLandmark: address.nearestLandmark,
    deliveryNote: address.deliveryNote,
    lat: address.lat === null ? null : Number(address.lat),
    lng: address.lng === null ? null : Number(address.lng),
    pinCode: address.pinCode,
    isDefault: address.isDefault,
    createdAt: address.createdAt,
  };
}

async function requireDistrict(districtId: number) {
  const district = await prisma.district.findUnique({
    where: { id: districtId },
    select: { id: true, name: true, countryId: true, country: { select: { isActive: true } } },
  });
  if (!district || !district.country.isActive) {
    throw unprocessable('Choose a valid delivery district');
  }
  return district;
}

/** Rejects `0772123456`-style typos before they become a rider calling a dead number. */
function assertPhoneUsable(raw: string, label: string) {
  const result = tryNormalisePhone(raw);
  if (!result.ok) throw unprocessable(`${label}: ${result.message}`);
  return result.phone.e164;
}

export async function listAddresses(userId: string): Promise<AddressView[]> {
  const rows = await prisma.shippingAddress.findMany({
    where: { userId, archivedAt: null },
    include: addressInclude,
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(toAddressView);
}

export async function createAddress(userId: string, input: AddressInput): Promise<AddressView> {
  const district = await requireDistrict(input.districtId);
  const recipientPhone = assertPhoneUsable(input.recipientPhone, 'Recipient phone');
  const alternativePhone = input.alternativePhone
    ? assertPhoneUsable(input.alternativePhone, 'Alternative phone')
    : undefined;

  const isFirstAddress = (await prisma.shippingAddress.count({ where: { userId, archivedAt: null } })) === 0;
  const shouldBeDefault = input.isDefault || isFirstAddress;

  const address = await prisma.$transaction(async (tx) => {
    if (shouldBeDefault) {
      await tx.shippingAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return tx.shippingAddress.create({
      data: {
        userId,
        label: input.label ?? 'Home',
        recipientName: input.recipientName,
        recipientPhone,
        alternativePhone,
        countryId: district.countryId,
        districtId: district.id,
        subcounty: input.subcounty,
        parish: input.parish,
        village: input.village,
        streetAddress: input.streetAddress,
        nearestLandmark: input.nearestLandmark,
        deliveryNote: input.deliveryNote,
        lat: input.lat,
        lng: input.lng,
        pinCode: input.pinCode,
        isDefault: shouldBeDefault,
      },
      include: addressInclude,
    });
  });

  return toAddressView(address);
}

export async function loadOwnedAddress(userId: string, addressId: string) {
  const address = await prisma.shippingAddress.findUnique({ where: { id: addressId }, select: { id: true, userId: true } });
  if (!address) throw notFound('That address no longer exists');
  if (address.userId !== userId) throw forbidden('That address belongs to another account');
  return address;
}

/**
 * Checkout needs the whole row — the order keeps a JSON copy of it — and refuses an address
 * the buyer archived, so a stale "Home (old)" entry cannot be shipped to by accident.
 */
export async function loadUsableAddress(userId: string, addressId: string): Promise<ShippingAddress> {
  const address = await prisma.shippingAddress.findUnique({ where: { id: addressId } });
  if (!address) throw notFound('That address no longer exists');
  if (address.userId !== userId) throw forbidden('That address belongs to another account');
  if (address.archivedAt) throw unprocessable('That address is archived — choose a current delivery stop');
  return address;
}

export async function updateAddress(userId: string, addressId: string, patch: AddressPatch): Promise<AddressView> {
  await loadOwnedAddress(userId, addressId);

  const data: Prisma.ShippingAddressUpdateInput = {};
  if (patch.label !== undefined) data.label = patch.label;
  if (patch.recipientName !== undefined) data.recipientName = patch.recipientName;
  if (patch.subcounty !== undefined) data.subcounty = patch.subcounty;
  if (patch.parish !== undefined) data.parish = patch.parish;
  if (patch.village !== undefined) data.village = patch.village;
  if (patch.streetAddress !== undefined) data.streetAddress = patch.streetAddress;
  if (patch.nearestLandmark !== undefined) data.nearestLandmark = patch.nearestLandmark;
  if (patch.deliveryNote !== undefined) data.deliveryNote = patch.deliveryNote;
  if (patch.pinCode !== undefined) data.pinCode = patch.pinCode;
  if (patch.lat !== undefined) data.lat = patch.lat;
  if (patch.lng !== undefined) data.lng = patch.lng;

  if (patch.recipientPhone !== undefined) data.recipientPhone = assertPhoneUsable(patch.recipientPhone, 'Recipient phone');
  if (patch.alternativePhone !== undefined) {
    data.alternativePhone = patch.alternativePhone ? assertPhoneUsable(patch.alternativePhone, 'Alternative phone') : null;
  }

  if (patch.districtId !== undefined) {
    const district = await requireDistrict(patch.districtId);
    data.district = { connect: { id: district.id } };
    data.countryId = district.countryId;
  }

  if (patch.archived !== undefined) data.archivedAt = patch.archived ? new Date() : null;

  const wasDefault = (await prisma.shippingAddress.findUnique({ where: { id: addressId }, select: { isDefault: true } }))
    ?.isDefault;

  const address = await prisma.$transaction(async (tx) => {
    if (patch.isDefault === true) {
      await tx.shippingAddress.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      data.isDefault = true;
    }

    const updated = await tx.shippingAddress.update({
      where: { id: addressId },
      data,
      include: addressInclude,
    });

    // Archiving the default address would leave the buyer with none, so promote the newest live one.
    if (patch.archived === true && wasDefault) {
      await tx.shippingAddress.update({ where: { id: addressId }, data: { isDefault: false } });
      const next = await tx.shippingAddress.findFirst({
        where: { userId, archivedAt: null, id: { not: addressId } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (next) await tx.shippingAddress.update({ where: { id: next.id }, data: { isDefault: true } });
      updated.isDefault = false;
    }

    return updated;
  });

  return toAddressView(address);
}

/**
 * Orders keep their own JSON snapshot of the address, so deleting an address book entry
 * never rewrites delivery history — the rider's copy lives on the order.
 */
export async function deleteAddress(userId: string, addressId: string): Promise<{ deletedDefaultReassigned: boolean }> {
  await loadOwnedAddress(userId, addressId);

  return prisma.$transaction(async (tx) => {
    const target = await tx.shippingAddress.findUnique({ where: { id: addressId }, select: { isDefault: true } });
    await tx.shippingAddress.delete({ where: { id: addressId } });

    if (target?.isDefault) {
      const next = await tx.shippingAddress.findFirst({
        where: { userId, archivedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (next) {
        await tx.shippingAddress.update({ where: { id: next.id }, data: { isDefault: true } });
        return { deletedDefaultReassigned: true };
      }
    }
    return { deletedDefaultReassigned: false };
  });
}

/** `POST /api/shops` — full shop creation with district + country checks. */
export async function createShop(
  userId: string,
  input: {
    name: string;
    slug?: string;
    tagline?: string;
    description?: string;
    phone: string;
    whatsappNumber?: string;
    email?: string;
    country: 'UG' | 'KE';
    baseDistrictId: number;
    streetAddress?: string;
    defaultFulfilment: 'SELLER_DELIVERY' | 'SELLER_SELF_DELIVERY' | 'BUYER_PICKUP' | 'DIGITAL';
    dispatchSlaHours: number;
  },
) {
  const existing = await prisma.shop.findFirst({ where: { ownerId: userId, deletedAt: null }, select: { id: true } });
  if (existing) throw conflict('You already have a shop — edit it instead of opening another');

  const district = await prisma.district.findUnique({
    where: { id: input.baseDistrictId },
    select: { id: true, countryId: true, country: { select: { code: true } } },
  });
  if (!district) throw unprocessable('Choose the district you dispatch from');
  if (district.country.code !== input.country) {
    throw unprocessable(`That district is not in ${input.country === 'UG' ? 'Uganda' : 'Kenya'}`);
  }

  const phone = normalisePhone(input.phone, input.country);
  const whatsappNumber = input.whatsappNumber ? normalisePhone(input.whatsappNumber, input.country).e164 : undefined;

  const slug = input.slug
    ? await uniqueSlug(input.slug, shopSlugTaken)
    : await uniqueSlug(input.name, shopSlugTaken);

  const shop = await prisma.shop.create({
    data: {
      ownerId: userId,
      name: input.name,
      slug,
      tagline: input.tagline,
      description: input.description,
      phone: phone.e164,
      whatsappNumber,
      email: input.email,
      countryId: district.countryId,
      baseDistrictId: district.id,
      streetAddress: input.streetAddress,
      defaultFulfilment: input.defaultFulfilment,
      dispatchSlaHours: input.dispatchSlaHours,
      status: 'PENDING',
    },
    select: { id: true, name: true, slug: true, status: true, kycStatus: true },
  });

  // Opening a stall is what makes a buyer a seller. An admin keeps the ADMIN role: the
  // filter on `role: 'BUYER'` is what stops this from ever demoting them.
  await prisma.user.updateMany({ where: { id: userId, role: 'BUYER' }, data: { role: 'SELLER' } });

  return shop;
}
/** Payout details are stored verbatim: a wrong MoMo number sends real money to a stranger. */
export async function upsertPayoutAccount(
  shopId: string,
  input: z.infer<typeof payoutAccountSchema>,
) {
  const number = normaliseAccountNumber(input.accountNumber, input.provider);
  return prisma.payoutAccount.upsert({
    where: { shopId },
    create: {
      shopId,
      provider: input.provider,
      accountNumber: number,
      accountName: input.accountName,
      bankName: input.bankName,
    },
    update: {
      provider: input.provider,
      accountNumber: number,
      accountName: input.accountName,
      bankName: input.bankName,
      // Changing the destination invalidates the earlier verification.
      isVerified: false,
      verifiedAt: null,
    },
    select: { id: true, provider: true, accountNumber: true, accountName: true, bankName: true, isVerified: true },
  });
}

/** MoMo providers route on E.164; bank numbers are literal account digits. */
function normaliseAccountNumber(raw: string, provider: 'MTN_MOMO' | 'AIRTEL_MONEY' | 'BANK'): string {
  if (provider === 'BANK') return raw.replace(/\s+/g, '');
  const result = tryNormalisePhone(raw);
  if (!result.ok) throw unprocessable('Enter the mobile money number with its country code, e.g. 0772123456');
  return result.phone.e164;
}
