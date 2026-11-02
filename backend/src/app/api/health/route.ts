import { withRoute, jsonBody, privateCache } from '@/lib/http';
import { prisma } from '@/lib/prisma';
import { availablePaymentProviders, env } from '@/lib/env';

/**
 * `GET /api/health`
 *
 * For an uptime check and for the person deploying at 6pm on a Friday. It answers three
 * questions and no more: is the process up, can it reach PostgreSQL, and which payment rails
 * have credentials on this box.
 *
 * It reports configuration as booleans only — never a key, a user name or a connection string —
 * because a health endpoint is usually the one URL a monitoring service is allowed to fetch
 * without auth.
 */
export const GET = withRoute(async () => {
  const startedAt = Date.now();

  let database: 'ok' | 'down' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'down';
  }

  const current = env();
  const body = {
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    nodeEnv: current.NODE_ENV,
    payments: availablePaymentProviders(),
    cashOnDelivery: current.COD_ENABLED,
    smsConfigured: Boolean(current.AFRICASTALKING_API_KEY),
    uploadsConfigured: Boolean(current.CLOUDINARY_CLOUD_NAME && current.CLOUDINARY_API_SECRET),
    uptimeSeconds: Math.round(process.uptime()),
    responseMs: Date.now() - startedAt,
  };

  // A monitor should page on a 5xx, not parse a 200 body for the word "down".
  return jsonBody(body, database === 'ok' ? 200 : 503, privateCache());
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
