'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';

/**
 * `POST /api/orders/{id}/cancel`
 *
 * A cancellation is a status, not a delete: the payment, the address snapshot and the status
 * history stay queryable. Money already taken becomes a `PENDING` refund in the operations
 * queue, so this button never promises an instant return of cash — the copy says "queued".
 *
 * `canRestock` is only true for the seller's own queue. A buyer cancels before the parcel is
 * packed, so the units were never gone and asking them about stock would be noise.
 */
export function CancelOrderForm({ orderId, canRestock = false }: { orderId: string; canRestock?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssues({});
    try {
      const result = await api.post<{ message: string }>(`/api/orders/${orderId}/cancel`, {
        reason: reason.trim(),
        restock,
      });
      toast.push(result.message, 'success');
      setOpen(false);
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(failure.issues);
        toast.push(failure.message, 'error');
      } else {
        toast.push('The order is still open — try again', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-clay-700 underline-offset-4 hover:underline"
      >
        Cancel this order
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-card border border-clay-200 bg-clay-50 p-4">
      <p className="text-sm font-semibold text-ink-900">Cancel this order</p>
      <p className="text-sm text-ink-600">
        The shop and the rider are told. Anything you already paid is queued for a refund to the number it came from —
        mobile money refunds take a day or two, not minutes.
      </p>

      <div>
        <label className="field-label" htmlFor={`cancel-${orderId}`}>
          Why are you cancelling?
        </label>
        <textarea
          id={`cancel-${orderId}`}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={300}
          required
          placeholder="Ordered the wrong size, and I need it for a function on Saturday"
          className="field-input resize-y"
        />
        {issues.reason && (
          <p role="alert" className="mt-1 text-sm text-clay-700">
            {issues.reason}
          </p>
        )}
      </div>

      {canRestock && (
        <label className="flex items-start gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={restock}
            onChange={(event) => setRestock(event.target.checked)}
            className="mt-0.5 size-4 accent-bemz-600"
          />
          <span>
            Put the units back on the shelf.
            <span className="block text-xs text-ink-500">
              Untick this once a rider has the parcel: those units come back as a return, after you inspect them.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" loading={busy} disabled={reason.trim().length < 5}>
          Confirm cancellation
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100"
        >
          Keep the order
        </button>
      </div>
    </form>
  );
}
