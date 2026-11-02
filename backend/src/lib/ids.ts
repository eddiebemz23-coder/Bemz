import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';

/**
 * Human-quotable identifiers. Buyers read order numbers over the phone to a seller or
 * to support, and sellers type them into the MoMo app note field, so they must be short,
 * unambiguous (no 0/O/1/I) and globally unique.
 *
 * Uniqueness is enforced by the database unique indexes; callers wrap inserts in
 * `withUniqueRetry` so a collision re-generates instead of surfacing a 500.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomToken(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

const stamp = (date: Date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;

/** BMZ-UG-20261029-7QK4MB — market + date makes the call centre able to spot a stale order. */
export const newOrderNumber = (countryCode: string, now = new Date()) =>
  `BMZ-${countryCode}-${stamp(now)}-${randomToken(6)}`;

/** One payment request per attempt; the provider echoes it back, so it doubles as the idempotency key. */
export const newPaymentExternalId = (now = new Date()) => `PMT-${stamp(now)}-${randomToken(12)}`;

/**
 * A checkout retried with the same client key must charge once, so the provider reference
 * is derived from that key instead of being random. MTN's `externalRef` accepts at most 20
 * characters, hence the hashed body.
 */
export function paymentExternalIdForKey(idempotencyKey: string, now = new Date()): string {
  const digest = createHmac('sha256', process.env.NEXTAUTH_SECRET ?? 'bemz-development-secret')
    .update(idempotencyKey)
    .digest();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 12; i += 1) suffix += alphabet[digest[i]! % alphabet.length];
  return `PMT-${stamp(now)}-${suffix}`;
}

export const newOrderGroupReference = (now = new Date()) => `BMG-${stamp(now)}-${randomToken(8)}`;

export const newRefundReference = (now = new Date()) => `REF-${stamp(now)}-${randomToken(8)}`;

export const newTrackingNumber = (now = new Date()) => `BMZD-${stamp(now)}-${randomToken(7)}`;

export const newOtpCode = (): string => {
  // 6 numeric digits; crypto randomness matters because the code authorises money movement.
  const bytes = randomBytes(4);
  const value = bytes.readUInt32BE(0) % 1_000_000;
  return String(value).padStart(6, '0');
};

export async function withUniqueRetry<T>(
  attempt: () => Promise<T>,
  options?: { retries?: number; onConflict?: (error: unknown) => boolean },
): Promise<T> {
  const retries = options?.retries ?? 3;
  const isConflict =
    options?.onConflict ??
    ((error: unknown) =>
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002');

  let lastError: unknown;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!isConflict(error) || i === retries) break;
    }
  }
  throw lastError;
}
