import { z } from 'zod';
import { withRoute, created, readJson, tooManyRequests } from '@/lib/http';
import { authLimiter } from '@/lib/rate-limit';
import { registerAccount } from '@/lib/services/accounts';
import { registerSchema } from '@/lib/validation/auth';
import { mergeGuestCart } from '@/lib/services/cart';

/**
 * `POST /api/auth/register`
 *
 * Phone + SMS code is the normal way in — an account is created on first OTP login.
 * This endpoint is for the form that also sets a password and, with `asSeller`, opens the
 * shop shell in the same request so the seller lands on a dashboard that already exists.
 * The number stays unverified until the buyer completes an OTP sign-in.
 */
const bodySchema = z
  .object({
    /** Guest basket token, so a filled cart survives sign-up. */
    cartToken: z.string().trim().min(8).max(64).optional(),
  })
  .passthrough();

export const POST = withRoute(async (request: Request) => {
  const limit = authLimiter(request, 'register');
  if (!limit.allowed) {
    throw tooManyRequests('Too many sign-up attempts, try again shortly', limit.retryAfterSeconds);
  }

  const payload = await readJson(request, bodySchema);
  const { cartToken, ...rest } = payload;
  const input = registerSchema.parse(rest);

  const result = await registerAccount(input);

  let cartMerged = false;
  if (cartToken) {
    // A dropped basket is the usual reason a first-time buyer abandons checkout.
    const cart = await mergeGuestCart({ guestToken: cartToken, userId: result.user.id }).catch(() => null);
    cartMerged = Boolean(cart);
  }

  return created({ ...result, cartMerged });
});

export const runtime = 'nodejs';
