import Link from 'next/link';
import { cn } from '@/lib/cn';

const pageWindow = (current: number, total: number): number[] => {
  const pages: number[] = [];
  for (let page = Math.max(1, current - 2); page <= Math.min(total, current + 2); page += 1) pages.push(page);
  return pages;
};

/**
 * Pagination that links instead of calling a callback, so a server-rendered grid works with no
 * JavaScript at all — which matters on a congested 3G cell where hydration may never finish.
 */
export function Pagination({
  page,
  perPage,
  total,
  hrefFor,
  className,
}: {
  page: number;
  perPage: number;
  total: number;
  hrefFor: (page: number) => string;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (totalPages <= 1) return null;

  return (
    <nav className={cn('flex flex-wrap items-center justify-center gap-1.5 py-6', className)} aria-label="Pages">
      {page > 1 && (
        <Link href={hrefFor(page - 1)} className="rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 hover:border-bemz-400">
          Previous
        </Link>
      )}
      {pageWindow(page, totalPages).map((candidate) =>
        candidate === page ? (
          <span key={candidate} aria-current="page" className="rounded-lg bg-bemz-600 px-3.5 py-2 text-sm font-semibold text-white">
            {candidate}
          </span>
        ) : (
          <Link key={candidate} href={hrefFor(candidate)} className="rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 hover:border-bemz-400">
            {candidate}
          </Link>
        ),
      )}
      {page < totalPages && (
        <Link href={hrefFor(page + 1)} className="rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-700 hover:border-bemz-400">
          Next
        </Link>
      )}
      <p className="w-full pt-1 text-center text-xs text-ink-400">
        {total.toLocaleString()} results · page {page} of {totalPages}
      </p>
    </nav>
  );
}
