'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import type { ProductStatus, SellerProductRow } from '@/lib/client/types';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';

/**
 * What the server's answer means in the seller's own terms.
 *
 * Asking to publish is not the same as being published: an unapproved shop, or a listing in a
 * category behind the ID gate, is put back in the review queue instead. The status comes from the
 * response rather than from what was requested, so the dashboard never claims a listing is live
 * when a moderator has not said so.
 */
const OUTCOME: Record<ProductStatus, string> = {
  ACTIVE: 'Live — buyers can order this now.',
  PENDING_REVIEW: 'Sent to the review team. It goes live when they approve it.',
  DRAFT: 'Put back in drafts. Only you can see it.',
  ARCHIVED: 'Taken down. Old orders keep their record.',
  REJECTED: 'The review team rejected this listing.',
};

export function ListingActions({ listing }: { listing: SellerProductRow }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT') {
    setError(null);
    try {
      const next = await api.post<{ status: ProductStatus }>(`/api/seller/products/${listing.id}/status`, { status });
      toast.push(OUTCOME[next.status] ?? 'Listing updated.', next.status === 'PENDING_REVIEW' ? 'info' : 'success');
      startTransition(() => router.refresh());
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'That did not work — check your connection and try again');
    }
  }

  async function retire() {
    setError(null);
    try {
      await api.del(`/api/seller/products/${listing.id}`);
      toast.push('Listing deleted. Orders already placed are unaffected.', 'success');
      startTransition(() => router.refresh());
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Could not delete this listing');
      setConfirmDelete(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {listing.status === 'ACTIVE' ? (
          <Button variant="outline" size="sm" loading={pending} onClick={() => setStatus('ARCHIVED')}>
            Take down
          </Button>
        ) : (
          <Button size="sm" loading={pending} onClick={() => setStatus('ACTIVE')}>
            Publish
          </Button>
        )}
        {listing.status === 'ACTIVE' && (
          <Button variant="ghost" size="sm" loading={pending} onClick={() => setStatus('DRAFT')}>
            Move to drafts
          </Button>
        )}
        {confirmDelete ? (
          <div className="flex items-center gap-2 rounded-lg bg-clay-50 px-2 py-1 ring-1 ring-inset ring-clay-200">
            <span className="text-xs text-clay-800">Delete this listing?</span>
            <Button variant="danger" size="sm" loading={pending} onClick={retire}>
              Yes, delete
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
              Keep
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-clay-700">
          {error}
        </p>
      )}
    </div>
  );
}
