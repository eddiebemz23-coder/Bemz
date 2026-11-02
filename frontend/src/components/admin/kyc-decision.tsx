'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { humanise } from '@/lib/client/format';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';

interface KycDocumentChoice {
  id: string;
  type: string;
  status: string;
}

/**
 * `POST /api/admin/kyc/{shopId}`
 *
 * A shop&rsquo;s KYC status is the union of its documents, so the reviewer chooses which papers
 * this decision covers rather than approving the shop as a whole: a clear selfie plus a blurred
 * ID means approve one, reject the other, and the stall stays closed until both are good.
 *
 * Only documents still `SUBMITTED` are offered. A batch already decided is history, and re-sending
 * it would overwrite the note the seller was given.
 */
export function KycDecisionForm({ shopId, shopName, documents }: { shopId: string; shopName: string; documents: KycDocumentChoice[] }) {
  const router = useRouter();
  const toast = useToast();

  const pending = documents.filter((document) => document.status === 'SUBMITTED');
  const [selected, setSelected] = useState<string[]>(pending.map((document) => document.id));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'APPROVE' | 'REJECT' | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  }

  async function decide(decision: 'APPROVE' | 'REJECT') {
    if (selected.length === 0) {
      setError('Tick at least one document');
      return;
    }
    if (decision === 'REJECT' && note.trim().length < 5) {
      setError('A rejection needs a reason the seller can act on');
      return;
    }
    setError(null);
    setBusy(decision);
    try {
      const result = await api.post<{ kycStatus: string; shopStatus: string }>(`/api/admin/kyc/${shopId}`, {
        documentIds: selected,
        decision,
        note: note.trim() || undefined,
      });
      toast.push(
        decision === 'APPROVE'
          ? `${shopName} is now ${humanise(result.kycStatus)}${result.shopStatus === 'ACTIVE' ? ' and the stall is open' : ''}.`
          : `${shopName} was sent back for a clearer photo.`,
        'success',
      );
      router.refresh();
    } catch (failure) {
      const message = failure instanceof ApiFailure ? failure.message : 'The decision did not save — try again';
      setError(message);
      toast.push(message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (pending.length === 0) {
    return (
      <p className="text-xs text-ink-500">
        Nothing is waiting on this shop right now — every document has already been decided.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-card bg-ink-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Decide {pending.length} submitted document{pending.length === 1 ? '' : 's'}</p>

      <ul className="space-y-1.5">
        {pending.map((document) => (
          <li key={document.id}>
            <label className="flex items-start gap-2 text-sm text-ink-800">
              <input
                type="checkbox"
                checked={selected.includes(document.id)}
                onChange={() => toggle(document.id)}
                className="mt-0.5 size-4 accent-bemz-600"
              />
              <span>{humanise(document.type)}</span>
            </label>
          </li>
        ))}
      </ul>

      <div>
        <label className="field-label" htmlFor={`kyc-note-${shopId}`}>
          Note for the seller (required to reject)
        </label>
        <textarea
          id={`kyc-note-${shopId}`}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={400}
          className="field-input resize-y"
          placeholder="The ID photo is blurry — take it again in daylight, flat on the table."
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-clay-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy === 'APPROVE'} disabled={busy === 'REJECT'} onClick={() => void decide('APPROVE')}>
          Approve selected
        </Button>
        <Button size="sm" variant="danger" loading={busy === 'REJECT'} disabled={busy === 'APPROVE'} onClick={() => void decide('REJECT')}>
          Reject selected
        </Button>
      </div>
    </div>
  );
}
