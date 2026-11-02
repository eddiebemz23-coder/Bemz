import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { prisma, type PhoneOtpCode } from './prisma';
import { env } from './env';
import { normalisePhone, type SupportedRegion } from './phone';
import { newOtpCode } from './ids';
import { sendSms } from './sms';
import { ApiError, tooManyRequests } from './http';

/**
 * SMS one-time-password flow — the primary way people sign in and confirm orders in
 * Uganda and Kenya. Codes are stored as an HMAC so a database dump cannot be replayed
 * against the login endpoint, and every verification attempt is recorded on the row.
 */

export type OtpPurpose = 'LOGIN' | 'REGISTER' | 'ORDER_CONFIRM' | 'SELLER_VERIFY';

const pepper = () => env().NEXTAUTH_SECRET;

function hashCode(phone: string, purpose: OtpPurpose, code: string): string {
  return createHmac('sha256', pepper()).update(`${phone}:${purpose}:${code}`).digest('hex');
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export class OtpError extends ApiError {}

type RequestOtpInput = {
  /** Raw value as typed by the user; normalised here so clients cannot inject formats. */
  phone: string;
  purpose: OtpPurpose;
  defaultRegion?: SupportedRegion;
  /** When false, an unknown number is rejected (used by ORDER_CONFIRM / SELLER_VERIFY). */
  allowNewAccount?: boolean;
};

export type RequestedOtp = {
  e164: string;
  expiresInSeconds: number;
  cooldownSeconds: number;
  /** Only present outside production so a developer can read the code without an SMS gateway. */
  devCode?: string;
};

export async function requestOtp(input: RequestOtpInput): Promise<RequestedOtp> {
  const config = env();
  const phone = normalisePhone(input.phone, input.defaultRegion ?? 'UG');

  const existing = await prisma.user.findUnique({ where: { phone: phone.e164 } });
  if (!existing && !input.allowNewAccount) {
    throw new OtpError(404, 'account_not_found', 'No Bemz account uses this number yet');
  }
  if (existing?.lockedUntil && existing.lockedUntil > new Date()) {
    throw new OtpError(
      423,
      'account_locked',
      'Too many failed attempts. Try again later or contact support.',
    );
  }

  const last = await prisma.phoneOtpCode.findFirst({
    where: { phone: phone.e164, purpose: input.purpose },
    orderBy: { createdAt: 'desc' },
  });
  const cooldownMs = config.OTP_RESEND_COOLDOWN_SECONDS * 1000;
  if (last && Date.now() - last.createdAt.getTime() < cooldownMs) {
    const waitSeconds = Math.ceil((cooldownMs - (Date.now() - last.createdAt.getTime())) / 1000);
    throw tooManyRequests(`Please wait ${waitSeconds}s before requesting another code`, waitSeconds);
  }

  // A number must not accumulate live codes: revoke anything still outstanding.
  await prisma.phoneOtpCode.updateMany({
    where: { phone: phone.e164, purpose: input.purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const code = newOtpCode();
  const expiresAt = new Date(Date.now() + config.OTP_TTL_SECONDS * 1000);

  await prisma.phoneOtpCode.create({
    data: {
      userId: existing?.id,
      phone: phone.e164,
      purpose: input.purpose,
      codeHash: hashCode(phone.e164, input.purpose, code),
      expiresAt,
      maxAttempts: config.OTP_MAX_ATTEMPTS,
    },
  });

  const message =
    input.purpose === 'ORDER_CONFIRM'
      ? `Bemz: confirm order with code ${code}. Valid ${Math.round(
          config.OTP_TTL_SECONDS / 60,
        )} mins. Never share this code.`
      : `Bemz: your verification code is ${code}. Valid ${Math.round(
          config.OTP_TTL_SECONDS / 60,
        )} mins. Never share this code.`;

  await sendSms({ to: phone.e164, message, userId: existing?.id });

  return {
    e164: phone.e164,
    expiresInSeconds: config.OTP_TTL_SECONDS,
    cooldownSeconds: config.OTP_RESEND_COOLDOWN_SECONDS,
    devCode: config.NODE_ENV === 'production' ? undefined : code,
  };
}

export type VerifiedOtp = {
  e164: string;
  userId: string;
  isNewAccount: boolean;
};

export async function verifyOtp(params: {
  phone: string;
  purpose: OtpPurpose;
  code: string;
  defaultRegion?: SupportedRegion;
  /** Required when the flow creates an account (LOGIN for a brand-new number). */
  name?: string;
}): Promise<VerifiedOtp> {
  const phone = normalisePhone(params.phone, params.defaultRegion ?? 'UG');
  const hashed = hashCode(phone.e164, params.purpose, params.code.trim());

  const candidate: PhoneOtpCode | null = await prisma.phoneOtpCode.findFirst({
    where: {
      phone: phone.e164,
      purpose: params.purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!candidate) {
    throw new OtpError(410, 'otp_expired', 'That code has expired. Request a new one.');
  }

  if (candidate.attempts >= candidate.maxAttempts) {
    await prisma.phoneOtpCode.update({ where: { id: candidate.id }, data: { consumedAt: new Date() } });
    throw new OtpError(429, 'otp_attempts_exhausted', 'Too many wrong attempts. Request a new code.');
  }

  if (!constantTimeEquals(candidate.codeHash, hashed)) {
    await prisma.phoneOtpCode.update({
      where: { id: candidate.id },
      data: { attempts: { increment: 1 } },
    });
    throw new OtpError(401, 'otp_invalid', 'That code is not correct.');
  }

  await prisma.phoneOtpCode.update({
    where: { id: candidate.id },
    data: { consumedAt: new Date(), attempts: { increment: 1 } },
  });

  const now = new Date();
  let user = await prisma.user.findUnique({ where: { phone: phone.e164 } });
  let isNewAccount = false;

  if (!user) {
    if (params.purpose !== 'LOGIN' && params.purpose !== 'REGISTER') {
      throw new OtpError(404, 'account_not_found', 'No Bemz account uses this number yet');
    }
    const country = await prisma.country.findUnique({ where: { code: phone.region } });
    user = await prisma.user.create({
      data: {
        name: params.name ?? phone.national,
        phone: phone.e164,
        phoneVerified: now,
        countryId: country?.id,
        preferredCurrency: phone.region === 'UG' ? 'UGX' : 'KES',
      },
    });
    isNewAccount = true;
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { phoneVerified: user.phoneVerified ?? now, lastLoginAt: now, failedLoginCount: 0 },
    });
  }

  return { e164: phone.e164, userId: user.id, isNewAccount };
}

/** Used by the checkout "confirm by phone" path for cash-on-delivery orders. */
export const assertOrderConfirmOtp = (params: { phone: string; code: string }) =>
  verifyOtp({ ...params, purpose: 'ORDER_CONFIRM' });
