import { withRoute, jsonBody, readJson, tooManyRequests, unprocessable } from '@/lib/http';
import { authLimiter, otpLimiter } from '@/lib/rate-limit';
import { otpVerifySchema } from '@/lib/validation/auth';
import { verifyOtp } from '@/lib/otp';
import { prisma } from '@/lib/prisma';
import { normalisePhone } from '@/lib/phone';

/**
 * `POST /api/auth/otp/verify`
 *
 * Proves the caller holds the SIM for a number, without creating a web session — used for
 * `SELLER_VERIFY` before a payout number is saved, and to confirm an order.
 *
 * Signing in with a code deliberately does NOT go through this endpoint: it goes to
 * NextAuth's `phone-otp` provider, because a code can only be spent once and the session
 * must be minted in the same breath. Spending it here would break the next sign-in.
 */
export const POST = withRoute(async (request: Request) => {
  const ipLimit = authLimiter(request, 'otp-verify');
  if (!ipLimit.allowed) {
    throw tooManyRequests('Too many attempts from this device', ipLimit.retryAfterSeconds);
  }

  const body = await readJson(request, otpVerifySchema);
  if (body.purpose === 'LOGIN') {
    throw unprocessable('To sign in, submit the code to the phone-otp login — not to this endpoint');
  }

  const phoneLimit = otpLimiter(request, body.phone);
  if (!phoneLimit.allowed) {
    throw tooManyRequests('Too many code attempts for this number', phoneLimit.retryAfterSeconds);
  }

  const e164 = normalisePhone(body.phone, body.defaultRegion ?? 'UG').e164;
  const existing = await prisma.user.findUnique({
    where: { phone: e164 },
    select: { id: true, phoneVerified: true },
  });
  if (!existing) throw unprocessable('No Bemz account uses this phone number yet');

  // Consumes the code: counts the attempt, stamps consumedAt, rejects an expired row.
  await verifyOtp({
    phone: body.phone,
    purpose: body.purpose,
    code: body.code,
    defaultRegion: body.defaultRegion,
  });

  // A verified number is the cheapest fraud control we have: it gates payouts and COD.
  const user = await prisma.user.update({
    where: { id: existing.id },
    data: { phoneVerified: existing.phoneVerified ?? new Date() },
    select: { id: true, name: true, phone: true, role: true, phoneVerified: true },
  });

  return jsonBody({ verified: true, user });
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
