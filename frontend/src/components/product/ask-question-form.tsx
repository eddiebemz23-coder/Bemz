'use client';

import { useState } from 'react';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';

/**
 * Asking the seller. `POST /api/products/{shop}/{product}/questions` requires a session, so
 * signed-out visitors get the existing thread (which is public and cached) and nothing more.
 */
export function AskQuestionForm({ shopSlug, productSlug }: { shopSlug: string; productSlug: string }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/products/${shopSlug}/${productSlug}/questions`, { body });
      setBody('');
      setSent(true);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Could not send your question');
      setSent(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="field-label" htmlFor="question-body">
        Ask the seller about this item
      </label>
      <textarea
        id="question-body"
        rows={3}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          setSent(false);
        }}
        maxLength={600}
        required
        placeholder="Is this the 2024 model? Does it come with the charger?"
        className="field-input resize-y"
      />
      {error ? (
        <p role="alert" className="text-sm text-clay-700">
          {error}
        </p>
      ) : sent ? (
        <p className="text-sm text-bemz-700">Question posted. Sellers usually answer within a day.</p>
      ) : (
        <p className="text-xs text-ink-500">
          Your question appears on this listing. {600 - body.length} characters left.
        </p>
      )}
      <Button type="submit" loading={busy} disabled={body.trim().length < 5}>
        Post question
      </Button>
    </form>
  );
}
