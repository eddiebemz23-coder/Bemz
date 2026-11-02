import { formatMoney, type CurrencyCode } from '@/lib/money';
import type { Timestamp } from '@/lib/client/types';

/** Display helpers shared by server components and the browser bundle. */

const asDate = (value: Timestamp) => (value instanceof Date ? value : new Date(value));

export const formatDate = (value: Timestamp | null | undefined, style: 'short' | 'long' = 'short') => {
  if (!value) return '—';
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: style === 'short' ? 'short' : 'long',
    year: 'numeric',
  }).format(date);
};

export const formatDateTime = (value: Timestamp | null | undefined) => {
  if (!value) return '—';
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${formatDate(date)} · ${new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`;
};

/** "3 hours ago" — buyers judge a seller's responsiveness by this, not by a timestamp. */
export function formatRelative(value: Timestamp | null | undefined): string {
  if (!value) return '—';
  const date = asDate(value);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absolute = Math.abs(seconds);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
    ['second', 1],
  ];
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of units) {
    if (absolute >= size || unit === 'second') return formatter.format(Math.round(seconds / size), unit);
  }
  return formatter.format(seconds, 'second');
}

/** A countdown, because an unpaid MoMo order is only held for 30 minutes. */
export function formatCountdown(expiresAt: Timestamp | null | undefined, now = Date.now()): string {
  if (!expiresAt) return '—';
  const ms = asDate(expiresAt).getTime() - now;
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return 'Expired';
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
  return `${minutes}:${String(seconds).padStart(2, '0')} left`;
}

export const money = (minorUnits: number | null | undefined, currency: CurrencyCode, compact = false) =>
  formatMoney(minorUnits ?? 0, currency, { compact });

/** Basis points are how the schema stores every rate: 1250 bps is 12.5%. */
export const fromBps = (bps: number | null | undefined) => (bps == null ? '—' : `${(bps / 100).toFixed(2).replace(/\.00$/, '')}%`);

export const discountBadge = (pct: number | null | undefined) => (pct && pct > 0 ? `-${Math.round(pct)}%` : null);

export const etaLabel = (min: number | null | undefined, max: number | null | undefined) => {
  if (min == null || max == null) return 'Delivery time to be confirmed';
  if (min === max) return `${min} day${min === 1 ? '' : 's'}`;
  return `${min}-${max} days`;
};

/**
 * Mirrors `thumbUrl()` in the server media module. Cloudinary rewrites the URL instead of
 * serving a second file, and the server helper sits behind `import 'server-only'`.
 */
export function sizedImage(url: string | null | undefined, width = 300): string | undefined {
  if (!url) return undefined;
  if (!url.includes('/upload/')) return url;
  return url.replace('/upload/', `/upload/f_auto,q_auto,w_${width},c_limit/`);
}

/** `0772 123 456` reads better on a keypad than `+256772123456`. */
export function displayPhone(value: string | null | undefined, dialCode?: string): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  // `Country.phonePrefix` is stored as "+256", so the adornment is dropped before comparing.
  const prefix = (dialCode ?? '').replace(/\D/g, '');
  const national = prefix && digits.startsWith(prefix) ? digits.slice(prefix.length) : digits;
  if (national.length !== 9) return value;
  return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

const ORDER_TONE: Record<string, string> = {
  AWAITING_PAYMENT: 'bg-amber-100 text-amber-800 ring-amber-200',
  AWAITING_CONFIRMATION: 'bg-amber-100 text-amber-800 ring-amber-200',
  CONFIRMED: 'bg-sky-100 text-sky-800 ring-sky-200',
  PACKED: 'bg-indigo-100 text-indigo-800 ring-indigo-200',
  OUT_FOR_DELIVERY: 'bg-violet-100 text-violet-800 ring-violet-200',
  DELIVERED: 'bg-bemz-100 text-bemz-800 ring-bemz-200',
  CANCELLED: 'bg-ink-100 text-ink-700 ring-ink-200',
  REFUNDED: 'bg-clay-100 text-clay-800 ring-clay-200',
  FAILED: 'bg-clay-100 text-clay-800 ring-clay-200',
};

export const orderTone = (status: string) => ORDER_TONE[status] ?? 'bg-ink-100 text-ink-700 ring-ink-200';

export const humanise = (value: string | null | undefined) =>
  (value ?? '')
    .toLowerCase()
    .split(/[_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || '—';

export const paymentLabel = (provider: string) =>
  provider === 'MTN_MOMO'
    ? 'MTN Mobile Money'
    : provider === 'AIRTEL_MONEY'
      ? 'Airtel Money'
      : provider === 'STRIPE_CARD'
        ? 'Card'
        : provider === 'CASH_ON_DELIVERY'
          ? 'Cash on delivery'
          : humanise(provider);
