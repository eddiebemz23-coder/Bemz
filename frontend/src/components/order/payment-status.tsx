'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleCheck, CircleX, Loader2, RefreshCw } from 'lucide-react';
import { api, apiSafe } from '@/lib/client/api';
import type { CurrencyCode } from '@/lib/money';
import type { PaymentProvider, PaymentStatus, PaymentView } from '@/lib/client/types';
import { formatCountdown, money } from '@/lib/client/format';
import { regionForCurrency } from '@/lib/client/regions';
import { PhoneInput } from '@/components/auth/phone-input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';

interface StatusResponse {
  payment: PaymentView;
  order: { id: string; orderNumber: string; status: string; totalMinor: number; amountPaidMinor: number; expiresAt: string | null } | null;
  paid: boolean;
  settled: boolean;
  canRetry: boolean;
  message: string;
}

const POLL_MS = 5000;

/**
 * "Did my money go through?"
 *
 * MTN and Airtel answer the PIN prompt seconds or minutes later, and the callback sometimes
 * arrives after the buyer has already given up on the page — so this asks
 * `GET /api/payments/{id}/status`, which re-queries the operator when the payment is still open.
 * Polling stops the moment the rail says the charge is terminal; a settled payment is never
 * re-asked, because a late webhook cannot move an order backwards.
 */
export function PaymentStatus({
  paymentId,
  provider,
  currency,
  amountMinor,
  initialStatus,
}: {
  paymentId: string;
  provider: PaymentProvider;
  currency: CurrencyCode;
  amountMinor: number;
  initialStatus: PaymentStatus;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<StatusResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [payerPhone, setPayerPhone] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [region, setRegion] = useState<'UG' | 'KE'>(regionForCurrency(currency));
  const [showPhone, setShowPhone] = useState(false);
  const inFlight = useRef(false);

  const needsPhone = provider === 'MTN_MOMO' || provider === 'AIRTEL_MONEY';

  const check = useCallback(
    async ({ quiet = true }: { quiet?: boolean } = {}) => {
      if (inFlight.current) return;
      inFlight.current = true;
      if (!quiet) setChecking(true);
      const result = await apiSafe(() => api.get<StatusResponse>(`/api/payments/${paymentId}/status`));
      inFlight.current = false;
      setChecking(false);
      if (result.ok) {
        setState(result.data);
        if (result.data.paid && !quiet) router.refresh();
      } else if (!quiet) {
        toast.push(result.error.message, 'error');
      }
    },
    [paymentId, router, toast],
  );

  useEffect(() => {
    void check();
  }, [check]);

  const settled = state?.settled ?? ['SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED'].includes(initialStatus);

  useEffect(() => {
    if (settled) return;
    const handle = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(handle);
  }, [settled, check]);

  async function retry() {
    if (needsPhone && !showPhone) {
      setShowPhone(true);
      return;
    }
    setRetrying(true);
    setPhoneError(null);
    const result = await apiSafe(() =>
      api.post<{ payment: PaymentView; instruction: string; redirectUrl: string | null }>(
        `/api/payments/${paymentId}/retry`,
        needsPhone ? { payerPhone } : {},
      ),
    );
    setRetrying(false);
    if (!result.ok) {
      if (result.error.issues.payerPhone) setPhoneError(result.error.issues.payerPhone);
      else toast.push(result.error.message, 'error');
      return;
    }
    toast.push(result.data.instruction, 'success');
    if (result.data.redirectUrl) {
      window.location.assign(result.data.redirectUrl);
      return;
    }
    setShowPhone(false);
    setPayerPhone('');
    await check({ quiet: false });
    router.refresh();
  }

  const status = state?.payment.status ?? initialStatus;
  const paid = state?.paid ?? status === 'SUCCEEDED';
  const canRetry = state?.canRetry ?? false;
  const waiting = !paid && !canRetry;

  return (
    <section className="card space-y-4 p-5" aria-live="polite">
      <div className="flex items-start gap-3">
        {paid ? (
          <CircleCheck className="mt-0.5 size-6 shrink-0 text-bemz-600" aria-hidden />
        ) : canRetry ? (
          <CircleX className="mt-0.5 size-6 shrink-0 text-clay-600" aria-hidden />
        ) : (
          <Loader2 className="mt-0.5 size-6 shrink-0 animate-spin text-bemz-600" aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-ink-900">
            {paid
              ? 'Payment received'
              : canRetry
                ? 'Payment did not go through'
                : `Waiting for your ${providerLabel(provider)} confirmation`}
          </h2>
          <p className="mt-1 text-sm text-ink-600">
            {state?.message ??
              'Checking the payment network…'}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {money(amountMinor, currency)} · {providerLabel(provider)}
            {state?.payment.externalId ? ` · network reference ${state.payment.externalId}` : ''}
          </p>
        </div>
      </div>

      {waiting && state?.order?.expiresAt && (
        <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
          This order is held for the parcel until{' '}
          <span className="tabular font-semibold">{formatCountdown(state.order.expiresAt)}</span> run out. Stock is
          reserved while you pay.
        </p>
      )}

      {showPhone && (
        <div className="space-y-2">
          <PhoneInput
            label="Number that will be prompted"
            value={payerPhone}
            onChange={setPayerPhone}
            region={region}
            onRegionChange={setRegion}
            error={phoneError ?? undefined}
            autoComplete="tel"
          />
          <p className="text-xs text-ink-500">
            Enter the wallet number with a balance — a wrong number is the most common reason a prompt fails.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={canRetry ? 'primary' : 'outline'}
          size="sm"
          loading={retrying}
          disabled={paid || (!canRetry && state !== null)}
          onClick={() => void retry()}
        >
          {needsPhone && !showPhone ? 'Pay again with a different number' : 'Retry payment'}
        </Button>
        <Button variant="ghost" size="sm" loading={checking} onClick={() => void check({ quiet: false })}>
          <RefreshCw className="size-4" aria-hidden />
          Check now
        </Button>
      </div>

      {canRetry && (
        <p className="text-xs text-ink-500">
          Three attempts is the limit — after that a Bemz agent calls the number on the order, because a wallet that
          refused three times usually has a spend cap on it.
        </p>
      )}
    </section>
  );
}

function providerLabel(provider: PaymentProvider): string {
  if (provider === 'MTN_MOMO') return 'MTN Mobile Money';
  if (provider === 'AIRTEL_MONEY') return 'Airtel Money';
  if (provider === 'STRIPE_CARD') return 'card payment';
  return 'cash on delivery';
}
