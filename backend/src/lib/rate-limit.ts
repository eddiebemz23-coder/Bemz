import { env } from './env';

/**
 * Fixed-window limiter kept in-process.
 *
 * This is deliberately simple: it protects OTP, login and checkout spam on a single
 * node, which is the realistic traffic shape at launch. It is NOT correct across
 * multiple instances — set RATE_LIMIT_REDIS_URL and swap `consume` for an atomic
 * INCR/EXPIRE before scaling past one server.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type LimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

export function consume(key: string, limit: number, windowSeconds = 60): LimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

export function reset(key: string) {
  buckets.delete(key);
}

/** Best-effort client identity behind a CDN: first XFF entry, else the socket-less fallback. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export const authLimiter = (request: Request, action: string) =>
  consume(`auth:${action}:${clientIp(request)}`, env().AUTH_RATE_LIMIT_PER_MINUTE);

export const otpLimiter = (request: Request, phone: string) =>
  consume(`otp:${phone}:${clientIp(request)}`, 5, 60);

export const checkoutLimiter = (userId: string) => consume(`checkout:${userId}`, 20, 60);

/** Periodic housekeeping so abandoned buckets do not grow without bound. */
if (!('scheduleIdleCleanup' in globalThis)) {
  Object.defineProperty(globalThis, 'scheduleIdleCleanup', { value: true });
  const timer = setInterval(() => {
    const now = Date.now();
    buckets.forEach((bucket, key) => {
      if (bucket.resetAt <= now) buckets.delete(key);
    });
  }, 60_000);
  timer.unref?.();
}
