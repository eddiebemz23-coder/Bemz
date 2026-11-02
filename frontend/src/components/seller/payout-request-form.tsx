'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { money } from '@/lib/client/format';
import type { CurrencyCode } from '@/lib/money';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { useToast } from '@/components/toast';

const dateInput = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : '');

/**
 * `POST /api/seller/payouts`
 *
 * A seller picks a *period*, not an amount. The figure is recomputed from the orders that were
 * delivered, paid and out of the dispute window inside those dates — typing a number would be a
 * request to pay whatever the seller guessed, and two overlapping windows would pay the same
 * parcels twice.
 */
export function PayoutRequestForm({
  currency,
  windowStart,
  windowEnd,
  withdrawableMinor,
  minimumLabel,
  blockers,
}: {
  currency: CurrencyCode;
  windowStart: Date | null;
  windowEnd: Date;
  withdrawableMinor: number;
  minimumLabel: string;
  blockers: string[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [periodStart, setPeriodStart] = useState(dateInput(windowStart));
  const [periodEnd, setPeriodEnd] = useState(dateInput(windowEnd));
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setIssues({});

    if (!periodStart || !periodEnd) {
      setIssues({ form: 'Pick both dates — the start is the first delivery that has not been paid out' });
      return;
    }

    setBusy(true);
    try {
      const payout = await api.post<{ amountLabel: string; amountMinor: number }>('/api/seller/payouts', {
        // A bare date is local midnight; the API wants an instant with its offset so the dispute
        // window is measured the same way in Kampala and in Nairobi.
        periodStart: new Date(`${periodStart}T00:00:00`).toISOString(),
        periodEnd: new Date(`${periodEnd}T23:59:59`).toISOString(),
      });
      toast.push(`Withdrawing ${payout.amountLabel}. Finance takes one working day.`, 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const parsed = failure.issues;
        setIssues(Object.keys(parsed).length > 0 ? parsed : { form: failure.message });
      } else {
        setIssues({ form: 'The request did not go through — try again' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Withdraw</h2>
        <p className="mt-1 text-sm text-ink-700">
          <span className="tabular font-semibold">{money(withdrawableMinor, currency)}</span> is yours to take right now.
        </p>
      </div>

      {blockers.length > 0 && (
        <ul className="space-y-1 rounded-card bg-amber-50 px-3 py-2">
          {blockers.map((blocker) => (
            <li key={blocker} className="text-sm text-amber-900">
              {blocker}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="From"
          type="date"
          value={periodStart}
          onChange={(event) => setPeriodStart(event.target.value)}
          error={issues.periodStart}
          hint="The earliest unpaid delivery is pre-filled."
        />
        <TextField
          label="To"
          type="date"
          value={periodEnd}
          onChange={(event) => setPeriodEnd(event.target.value)}
          error={issues.periodEnd}
          hint="Parcels delivered in the dispute window are not in yet."
        />
      </div>

      {issues.form && (
        <p role="alert" className="rounded-card bg-clay-50 px-3 py-2 text-sm text-clay-800">
          {issues.form}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={busy} disabled={blockers.length > 0 || !periodStart || !periodEnd}>
          Request this period
        </Button>
        <p className="text-xs text-ink-500">
          The amount is calculated for you — the smallest request is {minimumLabel}.
        </p>
      </div>
    </form>
  );
}

/**
 * `POST /api/seller/payouts/{id}/withdraw`
 *
 * Pulling a request back is only possible while it is queued. Once finance has approved it the
 * transfer is committed, and a seller-side cancel would leave an approved payment with nowhere to
 * go — so the button disappears rather than turning into a lie.
 */
export function PayoutWithdrawButton({ payoutId, amountMinor, currency }: { payoutId: string; amountMinor: number; currency: CurrencyCode }) {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/seller/payouts/${payoutId}/withdraw`);
      toast.push('Request withdrawn — the money goes back to your available balance.', 'success');
      setConfirming(false);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Could not withdraw the request');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="text-xs font-medium text-clay-700 underline-offset-2 hover:underline" onClick={() => setConfirming(true)}>
        Withdraw request
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-clay-50 px-2 py-1 ring-1 ring-inset ring-clay-200">
      <span className="text-xs text-clay-800">Cancel the {money(amountMinor, currency)} request?</span>
      {error && <span className="text-xs text-clay-800">{error}</span>}
      <Button size="sm" variant="danger" loading={busy} onClick={() => void run()}>
        Yes
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
    </div>
  );
}
