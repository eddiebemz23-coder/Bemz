'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThumbsUp } from 'lucide-react';
import { api, ApiFailure } from '@/lib/client/api';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';

/**
 * "Was this useful?" — one vote per person, enforced by a unique index on
 * `(reviewId, userId)` in `voteHelpful`, so this button only has to reflect the server's count.
 */
export function HelpfulButton({
  reviewId,
  count,
  voted,
  signedIn,
}: {
  reviewId: string;
  count: number;
  voted: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState({ count, voted });
  const [busy, setBusy] = useState(false);

  async function vote() {
    if (!signedIn) {
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<{ helpfulCount: number; voted: boolean }>(`/api/reviews/${reviewId}/helpful`);
      setState({ count: result.helpfulCount, voted: result.voted });
    } catch (failure) {
      toast.push(failure instanceof ApiFailure ? failure.message : 'Could not record your vote', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={vote}
      disabled={busy}
      aria-pressed={state.voted}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
        state.voted ? 'border-bemz-300 bg-bemz-50 text-bemz-800' : 'border-ink-200 bg-white text-ink-600 hover:border-bemz-400',
      )}
    >
      <ThumbsUp className={cn('size-3.5', state.voted && 'fill-bemz-200')} />
      Helpful ({state.count})
    </button>
  );
}
