import bcrypt from 'bcryptjs';

/** bcrypt cost: 12 keeps a login verify around 250ms, which slows online password guessing. */
const SALT_ROUNDS = Number(process.env.AUTH_PASSWORD_SALT_ROUNDS ?? '12');

/**
 * Credential accounts only. Most buyers/sellers in Uganda and Kenya sign in with a
 * phone number and an SMS OTP and therefore have `passwordHash = null`.
 */
export function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export function verifyPassword(plaintext: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(plaintext, hash);
}

export function assessPasswordStrength(plaintext: string): { ok: boolean; reason?: string } {
  if (plaintext.length < 8) return { ok: false, reason: 'Password must be at least 8 characters' };
  if (!/[A-Za-z]/.test(plaintext)) return { ok: false, reason: 'Password must contain a letter' };
  if (!/[0-9]/.test(plaintext)) return { ok: false, reason: 'Password must contain a number' };
  return { ok: true };
}

/** True when an account may sign in with a password at all. */
export const hasCredentialLogin = (passwordHash: string | null | undefined): boolean => Boolean(passwordHash);
