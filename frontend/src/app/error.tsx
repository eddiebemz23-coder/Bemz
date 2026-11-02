'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Home, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LinkButton } from '@/components/ui/link-button';

/**
 * Route error boundary.
 *
 * `error.message` is only shown when the request was a database or network failure the buyer has
 * a right to know about — in production Next already replaces the message with a generic one, and
 * a stack trace on a storefront page tells a customer nothing while telling an attacker something.
 * What is useful here is the reset: a parcel search that failed on a cold connection should be
 * retryable without losing the page the buyer was on.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('bemz: route error', error);
  }, [error]);

  return (
    <div className="container-page max-w-xl py-16">
      <div className="card space-y-4 p-6 text-center">
        <p className="text-4xl font-bold text-ink-950">Something broke on our side</p>
        <p className="text-sm text-ink-600">
          The page could not be built. Your basket, your orders and your money are unchanged — this is the screen, not
          the transaction.
        </p>

        {error.digest && (
          <p className="tabular rounded-card bg-ink-50 px-3 py-2 text-xs text-ink-600">
            Incident reference <span className="font-semibold text-ink-800">{error.digest}</span> — quote this if you
            contact support and they can look the request up.
          </p>
        )}

        {process.env.NODE_ENV === 'development' && (
          <p className="break-words rounded-card bg-clay-50 px-3 py-2 text-left text-xs text-clay-800">
            {error.message}
          </p>
        )}

        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset}>
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </Button>
          <LinkButton href="/search" variant="outline">
            <Search className="size-4" aria-hidden />
            Search the market
          </LinkButton>
          <Link href="/" className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-700 hover:bg-ink-100">
            <Home className="size-4" aria-hidden />
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
