import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

/**
 * The four states that make a seller's dashboard behave differently from what it shows.
 *
 * Each one says what happens to a buyer rather than what the database flag is called, because a
 * trader who sees "PENDING" with no explanation keeps advertising the link on WhatsApp while
 * checkout rejects every order that comes from it.
 */
export function ShopStatusBanner({
  status,
  kycStatus,
  vacationMode,
}: {
  status: string;
  kycStatus: string;
  vacationMode: boolean;
}) {
  const notices: { tone: 'warning' | 'danger' | 'info'; title: string; body: string; href?: string; cta?: string }[] = [];

  if (status === 'PENDING') {
    notices.push({
      tone: 'warning',
      title: 'Your stall is waiting for review',
      body: 'Buyers can read your listings but cannot order until Bemz approves the shop.',
      href: '/seller/shop',
      cta: 'Finish your profile',
    });
  }
  if (status === 'SUSPENDED') {
    notices.push({
      tone: 'danger',
      title: 'This shop is suspended',
      body: 'Listings are hidden from checkout. Settle the issue with support to reopen it.',
    });
  }
  if (status === 'CLOSED') {
    notices.push({
      tone: 'danger',
      title: 'This shop is closed',
      body: 'Orders are no longer accepted. Your order history and payouts remain available here.',
    });
  }
  if (vacationMode && status !== 'CLOSED') {
    notices.push({
      tone: 'warning',
      title: 'Holiday mode is on',
      body: 'Your listings stay readable, but buyers cannot order. Switch it off when you are back at the shop.',
      href: '/seller/shop',
      cta: 'Turn holiday mode off',
    });
  }
  if (kycStatus === 'REJECTED') {
    notices.push({
      tone: 'danger',
      title: 'Your ID documents were rejected',
      body: 'Gated categories stay closed and no payout can be sent until you upload them again.',
      href: '/seller/shop',
      cta: 'Upload again',
    });
  } else if (kycStatus === 'NOT_SUBMITTED') {
    notices.push({
      tone: 'info',
      title: 'Upload your national ID',
      body: 'It covers phones, building materials and agro-chemicals, and you need it before your first payout.',
      href: '/seller/shop',
      cta: 'Upload documents',
    });
  } else if (kycStatus === 'SUBMITTED' || kycStatus === 'UNDER_REVIEW') {
    notices.push({
      tone: 'info',
      title: 'Your documents are with the review team',
      body: 'Gated categories and payouts open as soon as they are approved.',
    });
  }

  if (notices.length === 0) return null;

  return (
    <div className="space-y-2">
      {notices.map((notice) => (
        <div
          key={notice.title}
          className={`card flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
            notice.tone === 'danger'
              ? 'border-clay-200 bg-clay-50'
              : notice.tone === 'warning'
                ? 'border-amber-200 bg-amber-50'
                : 'border-sky-200 bg-sky-50'
          }`}
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
              <Badge tone={notice.tone === 'info' ? 'info' : notice.tone}>{notice.tone === 'danger' ? 'Action needed' : notice.tone === 'warning' ? 'Heads up' : 'Note'}</Badge>
              {notice.title}
            </p>
            <p className="mt-1 text-sm text-ink-700">{notice.body}</p>
          </div>
          {notice.href && (
            <Link
              href={notice.href}
              className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-ink-800 ring-1 ring-inset ring-ink-200 hover:bg-ink-50"
            >
              {notice.cta ?? 'Open'}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
