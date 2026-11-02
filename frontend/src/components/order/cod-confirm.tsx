'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquareText } from 'lucide-react';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';

interface CodeTicket {
  sentTo: string;
  expiresInSeconds: number;
  cooldownSeconds: number;
  devCode: string | null;
  message: string;
}

/**
 * Cash on delivery has to be proved by the phone owner.
 *
 * Without this step anyone who knows a number can order goods against it, which is why every
 * marketplace in both markets gates COD behind an SMS code. The number is read off the order by
 * the server, so this form cannot be pointed at somebody else's handset.
 *
 * The same code also releases an order that was already paid by mobile money — it sits in
 * AWAITING_CONFIRMATION until the buyer or the seller pushes it on — so the copy is passed in
 * rather than assumed: telling someone to "pay the rider" when the money is already taken is
 * how a receipt page loses trust.
 */
export function CashOnDeliveryConfirm({
  orderId,
  cashOnDelivery = true,
}: {
  orderId: string;
  cashOnDelivery?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [ticket, setTicket] = useState<CodeTicket | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const handle = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(handle);
  }, [cooldown]);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const sent = await api.post<CodeTicket>(`/api/orders/${orderId}/confirm/request`, {});
      setTicket(sent);
      setCooldown(sent.cooldownSeconds);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ orderNumber: string; message: string }>(`/api/orders/${orderId}/confirm`, { code });
      setConfirmed(true);
      toast.push(result.message, 'success');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'That code did not work');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  if (confirmed) {
    return (
      <p className="rounded-card bg-bemz-50 px-4 py-3 text-sm text-bemz-800">
        Order confirmed. The seller is packing
        {cashOnDelivery ? ' — have the exact amount ready when the rider arrives.' : '.'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">
        {cashOnDelivery
          ? 'Nothing is charged yet.'
          : 'This order is already paid.'}{' '}
        {ticket ? '' : 'First confirm it is really yours with a code by SMS.'}
      </p>

      {!ticket ? (
        <Button size="sm" loading={busy} onClick={() => void request()}>
          <MessageSquareText className="size-4" aria-hidden />
          Text me a confirmation code
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-2">
          <label className="field-label" htmlFor={`cod-code-${orderId}`}>
            6-digit code
          </label>
          <div className="flex gap-2">
            <input
              id={`cod-code-${orderId}`}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              className="field-input tabular w-36 text-center text-lg tracking-[0.3em]"
            />
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Confirm order
            </Button>
          </div>
          <p className="text-xs text-ink-500">
            Sent to {ticket.sentTo}. {ticket.devCode ? `Development mode — the code is ${ticket.devCode}.` : `The code expires in ${Math.round(ticket.expiresInSeconds / 60)} minutes.`}
          </p>
          {cooldown > 0 ? (
            <p className="text-xs text-ink-500">A new code can be sent in {cooldown}s.</p>
          ) : (
            <button type="button" onClick={() => void request()} className="text-xs font-medium text-bemz-700 hover:underline">
              Send the code again
            </button>
          )}
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-clay-700">
          {error}
        </p>
      )}
    </div>
  );
}
