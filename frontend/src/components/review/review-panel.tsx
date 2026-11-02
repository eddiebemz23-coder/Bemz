import type { ReactNode } from 'react';
import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import type { RatingBucket, ReviewCard } from '@/lib/client/types';
import { formatDate, sizedImage } from '@/lib/client/format';
import { cn } from '@/lib/cn';
import { Stars } from '@/components/ui/stars';
import { ListingImage } from '@/components/ui/listing-image';
import { HelpfulButton } from '@/components/review/helpful-button';
import { RatingBars } from '@/components/review/rating-bars';

export interface ReviewSummary {
  average: number | null;
  count: number;
  verifiedCount: number;
  breakdown: RatingBucket[];
}

/**
 * Reviews, exactly as `listProductReviews` returns them.
 *
 * Each star bucket is a link that sets `?reviewFilter=4` — those are the values
 * `reviewQuerySchema` accepts (`'5' | '4' | … | 'verified' | 'with_photos'`) — so filtering a
 * thread costs one GET, no client state, and the filtered thread is a link someone can send you.
 */
export function ReviewPanel({
  pathname,
  items,
  summary,
  page,
  perPage,
  total,
  filter,
  signedIn,
  emptyState,
}: {
  pathname: string;
  items: ReviewCard[];
  summary: ReviewSummary;
  page: number;
  perPage: number;
  total: number;
  filter: string;
  signedIn: boolean;
  emptyState?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-[minmax(0,220px)_1fr]">
        <div>
          <p className="text-4xl font-bold tabular text-ink-900">
            {summary.average === null ? '—' : summary.average.toFixed(1)}
          </p>
          <Stars value={summary.average} size="md" />
          <p className="mt-1 text-sm text-ink-500">
            {summary.count.toLocaleString()} {summary.count === 1 ? 'review' : 'reviews'}
          </p>
          <p className="mt-1 text-xs text-bemz-700">{summary.verifiedCount} from buyers who received the item</p>
        </div>

        <div className="space-y-3">
          <RatingBars
            breakdown={summary.breakdown}
            hrefFor={(rating) => reviewHref(pathname, filter, page, String(rating))}
          />
          <div className="flex gap-2 pt-1 text-xs">
            <FilterChip href={reviewHref(pathname, filter, page, 'all')} active={filter === 'all'}>
              All
            </FilterChip>
            <FilterChip href={reviewHref(pathname, filter, page, 'verified')} active={filter === 'verified'}>
              Verified only
            </FilterChip>
            <FilterChip href={reviewHref(pathname, filter, page, 'with_photos')} active={filter === 'with_photos'}>
              With photos
            </FilterChip>
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        emptyState ?? <p className="text-sm text-ink-500">No reviews in this filter yet.</p>
      ) : (
        <ul className="divide-y divide-ink-200">
          {items.map((review) => (
            <li key={review.id} className="py-4">
              <div className="flex items-center gap-2">
                <ListingImage src={review.author.avatarUrl} alt="" className="size-8 rounded-full" sizes="32px" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-900">{review.author.displayName}</p>
                  <p className="text-xs text-ink-500">{formatDate(review.createdAt)}</p>
                </div>
                {review.isVerifiedPurchase && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-bemz-50 px-2 py-0.5 text-[11px] font-medium text-bemz-800">
                    <BadgeCheck className="size-3" aria-hidden />
                    Verified purchase
                  </span>
                )}
              </div>

              <div className="mt-2">
                <Stars value={review.rating} />
              </div>
              {review.title && <p className="mt-1.5 text-sm font-semibold text-ink-900">{review.title}</p>}
              <p className="mt-1 text-sm leading-relaxed text-ink-700">{review.body}</p>

              {review.images.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {review.images.slice(0, 4).map((image, index) => (
                    <li key={`${review.id}-${index}`}>
                      <ListingImage
                        src={sizedImage(image, 160)}
                        alt={`Photo from ${review.author.displayName}'s review`}
                        className="size-16 rounded-lg"
                        sizes="64px"
                      />
                    </li>
                  ))}
                </ul>
              )}

              {review.sellerReply && (
                <div className="mt-2 rounded-card bg-ink-50 p-3">
                  <p className="text-xs font-semibold text-ink-700">Seller reply</p>
                  <p className="mt-1 text-sm text-ink-600">{review.sellerReply}</p>
                </div>
              )}

              <div className="mt-3">
                <HelpfulButton
                  reviewId={review.id}
                  count={review.helpfulCount}
                  voted={review.votedHelpful}
                  signedIn={signedIn}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {total > perPage && (
        <nav className="flex items-center gap-2 text-sm" aria-label="Review pages">
          {page > 1 && (
            <Link
              href={reviewPageHref(pathname, filter, page - 1)}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-ink-700 hover:border-bemz-400"
            >
              Previous
            </Link>
          )}
          <span className="text-ink-500">
            Page {page} of {Math.max(1, Math.ceil(total / perPage))}
          </span>
          {page * perPage < total && (
            <Link
              href={reviewPageHref(pathname, filter, page + 1)}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-ink-700 hover:border-bemz-400"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full px-2.5 py-1 transition-colors',
        active ? 'bg-bemz-600 font-semibold text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200',
      )}
    >
      {children}
    </Link>
  );
}

function withParams(pathname: string, values: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === '' || value === 1) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

const reviewHref = (pathname: string, filter: string, page: number, nextFilter: string) =>
  withParams(pathname, { reviewFilter: nextFilter === 'all' ? undefined : nextFilter, reviewPage: page });

const reviewPageHref = (pathname: string, filter: string, page: number) =>
  withParams(pathname, { reviewFilter: filter === 'all' ? undefined : filter, reviewPage: page });
