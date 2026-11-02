'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';

interface Choice {
  value: string;
  label: string;
  /** Shown under the button when the panel opens, so the operator knows what the click does. */
  hint?: string;
  /** Ask for the reason before sending. A decision a seller can read should never be blank. */
  needsReason?: boolean;
  variant?: 'primary' | 'danger' | 'secondary' | 'outline';
}

/**
 * The shape every admin decision takes: one endpoint, one status-or-decision field, and an
 * optional reason that lands in the audit row and in the other person&rsquo;s notification.
 *
 * Keeping it to one component means a rejection note is never optional in one queue and
 * optional in another — the reason is asked for in the same way wherever it changes a decision.
 */
export function AdminDecisionForm({
  endpoint,
  field,
  subject,
  choices,
  method = 'POST',
}: {
  endpoint: string;
  field: 'decision' | 'status';
  subject: string;
  choices: Choice[];
  method?: 'POST' | 'PATCH';
}) {
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState<Choice | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(choice: Choice, note: string) {
    setBusy(true);
    setError(null);
    const body = { [field]: choice.value, ...(choice.needsReason ? { reason: note.trim() } : {}) };
    try {
      if (method === 'PATCH') await api.patch(endpoint, body);
      else await api.post(endpoint, body);
      toast.push(`${choice.label} — ${subject}.`, 'success');
      setOpen(null);
      setReason('');
      router.refresh();
    } catch (failure) {
      const message = failure instanceof ApiFailure ? failure.message : 'The decision did not save — try again';
      setError(message);
      toast.push(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) =>
          choice.needsReason ? (
            <Button
              key={choice.value}
              size="sm"
              variant={choice.variant ?? 'outline'}
              disabled={busy || open !== null}
              onClick={() => {
                setOpen(choice);
                setError(null);
              }}
            >
              {choice.label}
            </Button>
          ) : (
            <Button
              key={choice.value}
              size="sm"
              variant={choice.variant ?? 'outline'}
              loading={busy && open?.value === choice.value}
              disabled={busy}
              onClick={() => void send(choice, '')}
            >
              {choice.label}
            </Button>
          ),
        )}
      </div>

      {open?.needsReason && (
        <div className="space-y-2 rounded-card bg-ink-50 p-3">
          <label className="field-label" htmlFor={`reason-${open.value}`}>
            {open.label} — why?
          </label>
          <p className="text-xs text-ink-500">{open.hint ?? 'This is filed in the audit trail and sent to the person affected.'}</p>
          <textarea
            id={`reason-${open.value}`}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={400}
            className="field-input resize-y"
            placeholder="Say what to fix, in words the seller can act on."
          />
          {error && (
            <p role="alert" className="text-sm text-clay-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={open.variant ?? 'secondary'}
              loading={busy}
              disabled={reason.trim().length < 5}
              onClick={() => void send(open, reason)}
            >
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * `PATCH /api/admin/shops/{shopId}` with only `verified` set — the badge is a separate lever from
 * the shop status, because a shop can be live and unverified, or verified and suspended.
 */
export function VerifiedToggle({ shopId, shopName, verified }: { shopId: string; shopName: string; verified: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function flip() {
    setBusy(true);
    try {
      await api.patch(`/api/admin/shops/${shopId}`, { verified: !verified });
      toast.push(`${verified ? 'Verified mark removed from' : 'Verified mark given to'} ${shopName}.`, 'success');
      router.refresh();
    } catch (failure) {
      toast.push(failure instanceof ApiFailure ? failure.message : 'Could not change the badge', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant={verified ? 'outline' : 'secondary'} loading={busy} onClick={() => void flip()}>
      {verified ? 'Remove verified mark' : 'Mark verified'}
    </Button>
  );
}
