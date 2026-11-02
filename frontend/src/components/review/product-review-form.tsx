'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { StarInput } from '@/components/ui/stars';
import { useToast } from '@/components/toast';

/**
 * Rating an item. The endpoint is addressed by the two slugs already in the URL, so this form
 * cannot be pointed at a different listing, and the "verified purchase" badge is decided by the
 * server from a DELIVERED order — the browser never claims it.
 */
export function ProductReviewForm({ shopSlug, productSlug }: { shopSlug: string; productSlug: string }) {
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
      await api.post(`/api/products/${shopSlug}/${productSlug}/reviews`, {
        rating,
        title: title.trim() || undefined,
        body: body.trim(),
        images: [],
      });
      setDone(true);
      setTitle('');
      setBody('');
      toast.push('Thanks — your review is on the listing.', 'success');
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
        <p className="field-label">Your rating</p>
        <div className="mt-1">
          <StarInput value={rating} onChange={setRating} name="product-rating" />
        </div>
        {issues.rating && (
          <p role="alert" className="mt-1 text-sm text-clay-700">
            {issues.rating}
          </p>
        )}
      </div>

      <div>
        <label className="field-label" htmlFor="product-review-title">
          Headline <span className="text-ink-400">(optional)</span>
        </label>
        <input
          id="product-review-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={100}
          placeholder="Battery lasts two days in the village"
          className="field-input"
        />
      </div>

      <div>
        <label className="field-label" htmlFor="product-review-body">
          What did you receive?
        </label>
        <textarea
          id="product-review-body"
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={4000}
          required
          placeholder="Did it match the photo and the description? How has it held up in daily use?"
          className="field-input resize-y"
        />
        {issues.body ? (
          <p role="alert" className="mt-1 text-sm text-clay-700">
            {issues.body}
          </p>
        ) : (
          <p className="mt-1 text-xs text-ink-500">
            {4000 - body.length} characters left. You can rate this item once; a rating from a delivered order is
            marked verified.
          </p>
        )}
      </div>

      <Button type="submit" loading={busy} disabled={rating === 0 || body.trim().length < 10}>
        Post review
      </Button>
    </form>
  );
}
