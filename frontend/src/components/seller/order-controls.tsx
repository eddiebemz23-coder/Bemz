'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import type { OrderStatus } from '@/lib/client/types';
import { Button } from '@/components/ui/button';
import { CheckboxField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/toast';

/**
 * The next step for each status, mirroring `ALLOWED_SELLER_TRANSITIONS` in the order service.
 * The server is the authority — this only decides which buttons to show so a seller is not
 * offered a jump the state machine would refuse.
 */
const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string; hint: string }[]>> = {
  AWAITING_CONFIRMATION: [
    { to: 'CONFIRMED', label: 'Confirm the order', hint: 'Tells the buyer you have the item and are packing it.' },
  ],
  CONFIRMED: [
    { to: 'PACKED', label: 'Mark as packed', hint: 'Takes the units off your stock for good.' },
  ],
  PACKED: [
    { to: 'OUT_FOR_DELIVERY', label: 'Hand to the rider', hint: 'Needs the tracking number the rider gave you.' },
    { to: 'DELIVERED', label: 'Delivered by me', hint: 'Only if you carried it yourself.' },
  ],
  OUT_FOR_DELIVERY: [
    { to: 'DELIVERED', label: 'Mark delivered', hint: 'Sets the clock on the buyer’s rating window.' },
  ],
};

/**
 * `POST /api/orders/{id}/status`
 *
 * Packing is the one step with a side effect the seller cannot see: it converts the units held in
 * the buyer's basket into a real deduction. So the checkbox is there, and unticking it is the way
 * to re-pack a parcel that was ticked with the wrong count without moving the ledger twice.
 */
export function SellerOrderControls({
  orderId,
  status,
  trackingNumber,
}: {
  orderId: string;
  status: OrderStatus;
  trackingNumber: string | null;
}) {
  const steps = NEXT[status] ?? [];
  if (steps.length === 0) {
    return <p className="text-xs text-ink-500">Nothing for you to do on this order.</p>;
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      {steps.map((step) => (
        <StepButton key={step.to} orderId={orderId} step={step} status={status} trackingNumber={trackingNumber} />
      ))}
    </div>
  );
}

function StepButton({
  orderId,
  step,
  status,
  trackingNumber,
}: {
  orderId: string;
  step: { to: OrderStatus; label: string; hint: string };
  status: OrderStatus;
  trackingNumber: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState(trackingNumber ?? '');
  const [courier, setCourier] = useState('');
  const [note, setNote] = useState('');
  const [consumedStock, setConsumedStock] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const needsTracking = step.to === 'OUT_FOR_DELIVERY' && !trackingNumber;

  async function advance() {
    if (needsTracking && tracking.trim().length < 4) {
      setError('Write the tracking number the rider gave you');
      return;
    }
    setError(null);
    try {
      await api.post(`/api/orders/${orderId}/status`, {
        to: step.to,
        note: note.trim() || undefined,
        trackingNumber: tracking.trim() || undefined,
        courierName: courier.trim() || undefined,
        consumedStock: status === 'CONFIRMED' ? consumedStock : true,
      });
      toast.push(`${step.label} — the buyer is told.`, 'success');
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'The order did not move — try again');
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant={step.to === 'DELIVERED' ? 'primary' : 'secondary'} onClick={() => setOpen(true)}>
        {step.label}
      </Button>
    );
  }

  return (
    <div className="w-full space-y-3 rounded-card bg-ink-50 p-3 sm:w-auto sm:min-w-[22rem]">
      <p className="text-sm font-medium text-ink-900">{step.label}</p>
      <p className="text-xs text-ink-500">{step.hint}</p>

      {needsTracking && (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Tracking number"
            value={tracking}
            onChange={(event) => setTracking(event.target.value)}
            maxLength={40}
            placeholder="FU102 9384 UG"
            required
          />
          <TextField
            label="Who carries it"
            value={courier}
            onChange={(event) => setCourier(event.target.value)}
            maxLength={80}
            placeholder="Bemz rider / my boda"
          />
        </div>
      )}

      {status === 'CONFIRMED' && (
        <CheckboxField
          label="Take the units off my stock"
          description="Untick only if you packed this parcel by mistake and are correcting the count."
          checked={consumedStock}
          onChange={(event) => setConsumedStock(event.target.checked)}
        />
      )}

      <TextField
        label="Note for the buyer (optional)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={300}
        placeholder="e.g. leaving with the rider at the Jinwa stage"
      />

      {error && (
        <p role="alert" className="text-sm text-clay-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Not yet
        </Button>
        <Button size="sm" loading={pending} onClick={() => void advance()}>
          Confirm
        </Button>
      </div>
    </div>
  );
}
