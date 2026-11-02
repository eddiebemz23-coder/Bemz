import { z } from 'zod';
import { withRoute, jsonBody, readJson, privateCache, unprocessable } from '@/lib/http';
import { requireUser } from '@/lib/auth/guards';
import { changePassword, removePassword } from '@/lib/services/accounts';
import { changePasswordSchema } from '@/lib/validation/auth';

/**
 * `POST /api/me/password`
 *
 * Most buyers never set a password — SMS is enough and a password they forget is a support
 * call. Sellers who share a stall login and admin staff do want one, so this is opt-in and
 * always proves the current password when one exists.
 */
export const POST = withRoute(async (request: Request) => {
  const user = await requireUser();
  const body = await readJson(request, changePasswordSchema);
  const result = await changePassword(user.id, body);
  return jsonBody(result, 200, privateCache());
});

const removeSchema = z.object({ currentPassword: z.string().min(1).max(200) });

/**
 * `DELETE /api/me/password`
 *
 * Drops credential login so the account is SMS-only again. Without a password, a leaked
 * database hash is no longer a risk for that user.
 */
export const DELETE = withRoute(async (request: Request) => {
  const user = await requireUser();
  const body = await readJson(request, removeSchema).catch(() => {
    throw unprocessable('Send your current password to remove password sign-in');
  });
  const result = await removePassword(user.id, body);
  return jsonBody(result, 200, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
