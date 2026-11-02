import Link from 'next/link';
import type { RatingBucket } from '@/lib/client/types';

/**
 * Star distribution, drawn once for both places it appears.
 *
 * The shop page wants a read-only picture of trust; the product page wants each count to be a
 * link into that star bucket's thread. Same bars, `hrefFor` decides whether the count is an
 * anchor or plain text — so a filtered review page and a shop rating card can never drift apart.
 */
export function RatingBars({
  breakdown,
  hrefFor,
}: {
  breakdown: RatingBucket[];
  hrefFor?: (rating: number) => string;
}) {
  const total = breakdown.reduce((sum, bucket) => sum + bucket.count, 0) || 1;

  return (
    <ul className="space-y-1.5">
      {breakdown.map((bucket) => {
        const count =
          hrefFor && bucket.count > 0 ? (
            <Link
              href={hrefFor(bucket.rating)}
              className="w-10 shrink-0 text-right tabular text-ink-600 hover:text-bemz-700"
            >
              {bucket.count}
            </Link>
          ) : (
            <span className="w-10 shrink-0 text-right tabular text-ink-600">{bucket.count}</span>
          );

        return (
          <li key={bucket.rating} className="flex items-center gap-3 text-sm">
            <span className="w-10 shrink-0 text-ink-500">{bucket.rating} star</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
              <span
                className="block h-full rounded-full bg-bemz-500"
                style={{ width: `${Math.round((bucket.count / total) * 100)}%` }}
              />
            </span>
            {count}
          </li>
        );
      })}
    </ul>
  );
}
