import { withRoute, jsonBody, readJson, tooManyRequests, serviceUnavailable } from '@/lib/http';
import { authLimiter, otpLimiter } from '@/lib/rate-limit';
import { otpRequestSchema } from '@/lib/validation/auth';
import { requestOtp, OtpError } from '@/lib/otp';
import { normalisePhone } from '@/lib/phone';

/**
 * `POST /api/auth/otp/request`
 *
 * Sends the 6-digit code. `LOGIN` is allowed to create an account for an unknown number
 * (that is how most first-time buyers arrive), while `SELLER_VERIFY` and `ORDER_CONFIRM`
 * must land on an existing account.
 */
export const POST = withRoute(async (request: Request) => {
  const ipLimit = authLimiter(request, 'otp-request');
  if (!ipLimit.allowed) {
    throw tooManyRequests('Too many code requests from this device, try again shortly', ipLimit.retryAfterSeconds);
  }

  const body = await readJson(request, otpRequestSchema);

  // A second, per-number limit: one SIM should not be able to bill us from one browser.
  const e164Preview = normalisePhone(body.phone, body.defaultRegion ?? 'UG').e164;
  const phoneLimit = otpLimiter(request, e164Preview);
  if (!phoneLimit.allowed) {
    throw tooManyRequests('Slow down — codes are already on the way', phoneLimit.retryAfterSeconds);
  }

  try {
    const result = await requestOtp({
      phone: body.phone,
      purpose: body.purpose,
      defaultRegion: body.defaultRegion,
      allowNewAccount: body.purpose === 'LOGIN',
    });
    return jsonBody({
      ...result,
      message:
        body.purpose === 'LOGIN'
          ? 'Check your messages for a 6-digit code. It expires shortly.'
          : 'Check your messages for a 6-digit code.',
    });
  } catch (error) {
    // An unreachable gateway is our failure, not the buyer's; keep the code unusable but
    // tell the client to retry rather than showing "invalid number".
    if (error instanceof OtpError) throw error;
    if (error instanceof Error && error.message.includes('SMS failed')) {
      throw serviceUnavailable('The SMS gateway did not accept the message — try again in a minute');
    }
    throw error;
  }
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
