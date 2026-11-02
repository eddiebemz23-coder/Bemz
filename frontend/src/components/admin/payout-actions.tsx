'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import type { CurrencyCode, PayoutStatus } from '@/lib/prisma';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';

/**
 * What finance can do to one payout request, given where it stands.
 *
 * Approval is a human check, not a payment: this deployment's mobile-money credentials are scoped
 * to *collection*, so the transfer is made in the operator portal and booked back here with the
 * portal's own reference. The server stores that reference uniquely, which is why there is no
 * "pay now" button — the platform cannot double-send something it never sent.
 */
const ACTIONS = {
  approve: {
    segment: 'approve',
    button: 'Approve',
    field: 'note',
    maxLength: 300,
    label: 'Note on this approval (optional)',
    placeholder: 'Checked the window against the ledger; account name matches the KYC.',
    min: 0,
    minMessage: '',
    variant: 'primary',
    success: 'Approved. Send it in the operator portal, then book the reference here.',
  },
  sent: {
    segment: 'sent',
    button: 'Book as sent',
    field: 'providerReference',
    maxLength: 80,
    label: 'Operator portal reference',
    placeholder: 'MTN-2026-1184023',
    min: 4,
    minMessage: 'Paste the transfer reference from the portal — it is unique, so it cannot be booked twice.',
    variant: 'primary',
    success: 'Booked as sent. The seller is told and their sales counter moves.',
  },
  fail: {
    segment: 'fail',
    button: 'Mark failed',
    field: 'reason',
    maxLength: 300,
    label: 'Why the transfer failed',
    placeholder: 'That number is not registered for mobile money.',
    min: 5,
    minMessage: 'The seller sees this and needs to know what to fix.',
    variant: 'danger',
    success: 'Marked failed. The money is back in the available balance.',
  },
  reverse: {
    segment: 'reverse',
    button: 'Reverse',
    field: 'reason',
    maxLength: 300,
    label: 'Why this payout is being reversed',
    placeholder: 'The seller says the money went to the wrong number.',
    min: 5,
    minMessage: 'A reversal undoes a completed payment — say why, it is filed against your name.',
    variant: 'danger',
    success: 'Reversed and returned to the balance.',
  },
} as const;

type ActionKey = keyof typeof ACTIONS;

const NEXT_STEP: Record<PayoutStatus, ActionKey[]> = {
  REQUESTED: ['approve', 'fail'],
  APPROVED: ['sent', 'fail'],
  SENT: ['reverse'],
  FAILED: [],
  REVERSED: [],
};

export function PayoutActions({
  payoutId,
  status,
  amountMinor,
  currency,
}: {
  payoutId: string;
  status: PayoutStatus;
  amountMinor: number;
  currency: CurrencyCode;
}) {
  const router = useRouter();
  const toast = useToast();

  const keys = NEXT_STEP[status];
  const [open, setOpen] = useState<ActionKey | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: (typeof ACTIONS)[ActionKey]) {
    if (value.trim().length < action.min) {
      setError(action.minMessage);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.post(`/api/admin/payouts/${payoutId}/${action.segment}`, { [action.field]: value.trim() });
      toast.push(action.success, 'success');
      setOpen(null);
      setValue('');
      router.refresh();
    } catch (failure) {
      const message = failure instanceof ApiFailure ? failure.message : 'Finance could not record that — try again';
      setError(message);
      toast.push(message, 'error');
    } finally {
      setBusy(false);
    }
  }

  if (keys.length === 0) {
    return <p className="text-xs text-ink-500">Closed — nothing finance can do to this request.</p>;
  }

  const active = open ? ACTIONS[open] : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {keys.map((key) => (
          <Button
            key={key}
            size="sm"
            variant={ACTIONS[key].variant}
            disabled={busy || (open !== null && open !== key)}
            onClick={() => {
              setOpen(key);
              setValue('');
              setError(null);
            }}
          >
            {ACTIONS[key].button}
          </Button>
        ))}
      </div>

      {active && (
        <div className="space-y-2 rounded-card bg-ink-50 p-3">
          <label className="field-label" htmlFor={`payout-${payoutId}-${active.segment}`}>
            {active.label}
          </label>
          <input
            id={`payout-${payoutId}-${active.segment}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            maxLength={active.maxLength}
            placeholder={active.placeholder}
            className="field-input"
          />
          {error && (
            <p role="alert" className="text-sm text-clay-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={active.variant} loading={busy} onClick={() => void run(active)}>
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
