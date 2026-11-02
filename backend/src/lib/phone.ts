import 'server-only';
import { parsePhoneNumberFromString, type CountryCode as LibCountryCode } from 'libphonenumber-js';

/**
 * Phone numbers are the primary identity in Uganda (+256) and Kenya (+254) — email is
 * optional. Everything is stored as E.164 so MTN MoMo / Airtel Money APIs receive a
 * number they can route, and so `0772123456`, `+256772123456` and `256772123456`
 * all resolve to the same account.
 */

export const SUPPORTED_REGIONS = ['UG', 'KE'] as const;
export type SupportedRegion = (typeof SUPPORTED_REGIONS)[number];

export const REGION_DIAL_CODES: Record<SupportedRegion, string> = {
  UG: '256',
  KE: '254',
};

export type NormalisedPhone = {
  e164: string;
  region: SupportedRegion;
  national: string; // 772123456 — what the buyer typed after the country code
  isMobile: boolean;
};

export class PhoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhoneError';
  }
}

/**
 * @param raw whatever the user typed (local format, +E164, with spaces or dashes)
 * @param defaultRegion used only when the number has no `+` country code
 */
export function normalisePhone(raw: string, defaultRegion: SupportedRegion = 'UG'): NormalisedPhone {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new PhoneError('Enter a phone number');

  const parsed = parsePhoneNumberFromString(trimmed, defaultRegion as LibCountryCode);
  if (!parsed) throw new PhoneError('That phone number is not valid');
  if (!parsed.country || !SUPPORTED_REGIONS.includes(parsed.country as SupportedRegion)) {
    throw new PhoneError('Only Ugandan (+256) and Kenyan (+254) numbers are supported');
  }
  if (!parsed.isPossible()) throw new PhoneError('That phone number looks incomplete');

  const region = parsed.country as SupportedRegion;
  const national = parsed.nationalNumber;

  return {
    e164: parsed.number,
    region,
    national,
    isMobile: parsed.getType() === 'MOBILE',
  };
}

export const tryNormalisePhone = (raw: string, defaultRegion?: SupportedRegion) => {
  try {
    return { ok: true as const, phone: normalisePhone(raw, defaultRegion) };
  } catch (error) {
    return { ok: false as const, message: error instanceof Error ? error.message : 'Invalid phone number' };
  }
};

export function currencyForRegion(region: SupportedRegion): 'UGX' | 'KES' {
  return region === 'UG' ? 'UGX' : 'KES';
}

/**
 * Mobile-money operator hints from the national prefix. Operators do issue new blocks,
 * so checkout always asks the buyer to confirm the wallet — this only pre-selects it.
 * Source: the ranges published by each operator for its own MoMo product.
 */
const OPERATOR_PREFIXES: Record<SupportedRegion, Array<{ prefix: string; provider: 'MTN_MOMO' | 'AIRTEL_MONEY' }>> = {
  UG: [
    { prefix: '77', provider: 'MTN_MOMO' },
    { prefix: '78', provider: 'MTN_MOMO' },
    { prefix: '75', provider: 'MTN_MOMO' }, // newer MTN block (also used by Airtel reissues)
    { prefix: '70', provider: 'AIRTEL_MONEY' },
    { prefix: '79', provider: 'AIRTEL_MONEY' },
    { prefix: '74', provider: 'AIRTEL_MONEY' },
    { prefix: '76', provider: 'AIRTEL_MONEY' },
  ],
  KE: [
    { prefix: '708', provider: 'AIRTEL_MONEY' },
    { prefix: '709', provider: 'AIRTEL_MONEY' },
    { prefix: '737', provider: 'AIRTEL_MONEY' },
    { prefix: '738', provider: 'AIRTEL_MONEY' },
    { prefix: '739', provider: 'AIRTEL_MONEY' },
    { prefix: '728', provider: 'AIRTEL_MONEY' },
  ],
};

export function guessMobileMoneyProvider(
  phone: NormalisedPhone | string,
): 'MTN_MOMO' | 'AIRTEL_MONEY' | undefined {
  const normalised = typeof phone === 'string' ? normalisePhone(phone) : phone;
  const dialCode = REGION_DIAL_CODES[normalised.region];
  const withoutDial = normalised.e164.replace(`+${dialCode}`, '');
  // Three-digit prefixes are checked before two-digit ones.
  const candidates = [...OPERATOR_PREFIXES[normalised.region]].sort(
    (a, b) => b.prefix.length - a.prefix.length,
  );
  return candidates.find((candidate) => withoutDial.startsWith(candidate.prefix))?.provider;
}

/** Shown in the UI next to an input so the buyer sees the expected shape. */
export const phonePlaceholder = (region: SupportedRegion) =>
  region === 'UG' ? '077 1234567' : '0712 345678';

/**
 * A confirmation screen has to say WHERE a code went without printing a number that could be
 * read over a shoulder at a cyber café or copied out of a screenshot.
 */
export const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return '••••••';
  return `${digits.slice(0, 3)} •••• ${digits.slice(-3)}`;
};

export const isSupportedRegion = (value: string): value is SupportedRegion =>
  (SUPPORTED_REGIONS as readonly string[]).includes(value);

/** Exposed for the login/signup country selector. */
export const SUPPORTED_COUNTRIES = SUPPORTED_REGIONS.map((region) => ({
  region,
  dialCode: REGION_DIAL_CODES[region],
  currency: currencyForRegion(region),
  placeholder: phonePlaceholder(region),
}));
