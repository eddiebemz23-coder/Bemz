import { z } from 'zod';

const BooleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1).optional(),

  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXTAUTH_URL: z.string().url().default('http://localhost:3000'),
  NEXTAUTH_SECRET: z
    .string()
    .min(16, 'NEXTAUTH_SECRET must be at least 16 characters (openssl rand -base64 32)'),

  AUTH_PASSWORD_SALT_ROUNDS: z.coerce.number().int().min(8).max(15).default(12),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),

  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),

  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  CLOUDINARY_UPLOAD_PRESET: z.string().min(1).default('bemz-product'),
  CLOUDINARY_KYC_FOLDER: z.string().min(1).default('bemz/kyc'),
  CLOUDINARY_PRODUCT_FOLDER: z.string().min(1).default('bemz/products'),

  AFRICASTALKING_USERNAME: z.string().min(1).optional(),
  AFRICASTALKING_API_KEY: z.string().min(1).optional(),
  AFRICASTALKING_SENDER_ID: z.string().min(1).default('BEMZ'),

  MTN_MOMO_BASE_URL: z.string().url().default('https://momoapi.mtn.co.ug/momo/api/v1'),
  MTN_MOMO_SUBSCRIPTION_KEY: z.string().min(1).optional(),
  MTN_MOMO_API_USER: z.string().min(1).optional(),
  MTN_MOMO_API_SECRET: z.string().min(1).optional(),
  MTN_MOMO_PRIMARY_KEY: z.string().min(1).optional(),
  MTN_MOMO_CALLBACK_BASE_URL: z.string().url().default('http://localhost:3000/api/webhooks'),
  MTN_MOMO_COLLECTION_TARGET: z.string().min(1).default('bemz_marketplace'),

  AIRTEL_BASE_URL_UG: z.string().url().default('https://mobileairtimeapi.airtel.co.ug/msisdn/api'),
  AIRTEL_BASE_URL_KE: z.string().url().default('https://airteloutsourcing.com/merchantapi'),
  AIRTEL_CLIENT_ID_UG: z.string().min(1).optional(),
  AIRTEL_CLIENT_SECRET_UG: z.string().min(1).optional(),
  AIRTEL_MERCHANT_CODE_UG: z.string().min(1).optional(),
  AIRTEL_CLIENT_ID_KE: z.string().min(1).optional(),
  AIRTEL_CLIENT_SECRET_KE: z.string().min(1).optional(),
  AIRTEL_MERCHANT_CODE_KE: z.string().min(1).optional(),
  AIRTEL_USE_SANDBOX: BooleanString.default('true'),

  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

  COD_ENABLED: BooleanString.default('true'),
  PLATFORM_COMMISSION_DEFAULT_BPS: z.coerce.number().int().min(0).max(5000).default(1250),
  SELLER_PAYOUT_MIN_MINOR: z.coerce.number().int().positive().default(10_000_000),
  /** Days after delivery before a parcel's money can be withdrawn — the dispute window. */
  SELLER_SETTLEMENT_DELAY_DAYS: z.coerce.number().int().min(0).max(60).default(7),

  /**
   * Shared secret for the unattended maintenance endpoints (`/api/ops/*`), which a cron
   * scheduler calls without a browser session. Optional: when unset, those routes are only
   * reachable by a signed-in admin.
   */
  OPS_SWEEP_TOKEN: z.string().min(16).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/**
 * `.env.example` leaves every optional credential as `KEY=` so a new file has the right shape, but
 * an empty string counts as *present* to Zod and `z.string().min(1)` rejects it — a machine with no
 * MTN account would fail to boot instead of running with that rail switched off. A blank value is
 * read as unset, which is what the feature flags in `availablePaymentProviders` already assume.
 */
function blankMeansUnset(record: Record<string, string | undefined>): Record<string, string | undefined> {
  const cleaned: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(record)) cleaned[key] = value === '' ? undefined : value;
  return cleaned;
}

/**
 * Parsed lazily so `next build` on a machine without the payment secrets does not
 * hard-fail; the first request that needs an unset variable gets an actionable error.
 */
export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(blankMeansUnset(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nCopy .env.example to .env and fill it in.`);
  }
  cached = parsed.data;
  return cached;
}

/** Feature flags that depend on credentials being present, used to gate providers at runtime. */
export function availablePaymentProviders() {
  const current = env();
  return {
    mtnMomo: Boolean(current.MTN_MOMO_API_USER && current.MTN_MOMO_API_SECRET && current.MTN_MOMO_SUBSCRIPTION_KEY),
    airtelMoney: Boolean(current.AIRTEL_CLIENT_ID_UG || current.AIRTEL_CLIENT_ID_KE),
    stripe: Boolean(current.STRIPE_SECRET_KEY),
    cashOnDelivery: current.COD_ENABLED,
  };
}

export const isProduction = () => env().NODE_ENV === 'production';
