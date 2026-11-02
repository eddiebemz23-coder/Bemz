'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { TextAreaField } from '@/components/ui/field';
import { useToast } from '@/components/toast';

/**
 * `POST /api/seller/questions/{id}/answer`
 *
 * An answer is public and permanent on the listing, so it is written as something a buyer will
 * still want read next month: no "call me", no phone number, straight to the answer.
 */
export function AnswerQuestionForm({ questionId, productTitle }: { questionId: string; productTitle: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (body.trim().length < 5) {
      setError('Write at least a sentence — the answer is shown to every buyer');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/seller/questions/${questionId}/answer`, { body: body.trim() });
      toast.push(`Answer posted on ${productTitle}.`, 'success');
      setOpen(false);
      setBody('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'The answer did not post — try again');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Answer
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-card bg-ink-50 p-3">
      <TextAreaField
        label="Your answer"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="In stock in 64 GB; a rider can reach Nansana the same day."
        error={error ?? undefined}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" loading={busy} disabled={body.trim().length < 5} onClick={() => void submit()}>
          Post answer
        </Button>
      </div>
    </div>
  );
}

/**
 * `POST /api/seller/reviews/{id}/reply`
 *
 * One reply per review, and it is public. Future buyers read it as the seller's temperament, so a
 * five-star reply costs nothing and a defensive one costs the next sale.
 */
export function ReplyToReviewForm({ reviewId, rating }: { reviewId: string; rating: number }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (reply.trim().length < 5) {
      setError('Say something the next buyer can use');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/seller/reviews/${reviewId}/reply`, { reply: reply.trim() });
      toast.push(rating >= 4 ? 'Replied — buyers see your name under the stars.' : 'Reply published.', 'success');
      setOpen(false);
      setReply('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'The reply did not post — try again');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Reply
      </Button>
    );
  }

  return (
    <div className="w-full space-y-2 rounded-card bg-ink-50 p-3">
      <TextAreaField
        label="Public reply"
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Thank you — the spare fuse is in the pocket under the seat, ask us and we ship one free."
        error={error ?? undefined}
        hint="You can reply once on each review."
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="sm" loading={busy} disabled={reply.trim().length < 5} onClick={() => void submit()}>
          Publish reply
        </Button>
      </div>
    </div>
  );
}
