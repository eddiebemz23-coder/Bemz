'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { StarInput } from '@/components/ui/stars';
import { useToast } from '@/components/toast';

/**
 * Rating a stall. The thread below is server-rendered, so a new review appears by refreshing the
 * route instead of threading state through the panel — and the server stays the only place that
 * decides whether a review is published.
 */
export function ShopReviewForm({ shopSlug }: { shopSlug: string }) {
  const router = useRouter();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssues({});
    try {
      await api.post(`/api/shops/${shopSlug}/reviews`, {
        rating,
        title: title.trim() || undefined,
        body: body.trim(),
        images: [],
      });
      setDone(true);
      setTitle('');
      setBody('');
      toast.push('Thanks — your rating is live on this shop.', 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(failure.issues);
        toast.push(failure.message, 'error');
      } else {
        toast.push('Could not save your review', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="rounded-card bg-bemz-50 px-4 py-3 text-sm text-bemz-800">
        Review posted. It is on the thread now — thank you for telling other buyers.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div>
        <p className="field-label">How did it go?</p>
        <div className="mt-1">
          <StarInput value={rating} onChange={setRating} name="shop-rating" />
        </div>
        {issues.rating && (
          <p role="alert" className="mt-1 text-sm text-clay-700">
            {issues.rating}
          </p>
        )}
      </div>

      <div>
        <label className="field-label" htmlFor="shop-review-title">
          Headline <span className="text-ink-400">(optional)</span>
        </label>
        <input
          id="shop-review-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={100}
          placeholder="Delivered in Gulu in two days"
          className="field-input"
        />
      </div>

      <div>
        <label className="field-label" htmlFor="shop-review-body">
          What happened
        </label>
        <textarea
          id="shop-review-body"
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={4000}
          required
          placeholder="Did the parcel match the photo? How long did dispatch take? Was the rider easy to reach?"
          className="field-input resize-y"
        />
        {issues.body ? (
          <p role="alert" className="mt-1 text-sm text-clay-700">
            {issues.body}
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink-500">
            {4000 - body.length} characters left. Ratings from buyers who received an order are marked verified.
          </p>
        )}
      </div>

      <Button type="submit" loading={busy} disabled={rating === 0 || body.trim().length < 10}>
        Post review
      </Button>
    </form>
  );
}
