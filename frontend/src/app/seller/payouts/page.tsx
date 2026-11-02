import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleDollarSign, Landmark } from 'lucide-react';
import { sellerPage } from '@/lib/seller-page';
import { payoutHistory, payoutSummary } from '@/lib/services/payouts';
import { parseParams, hrefWith } from '@/lib/catalog-params';
import { pagination } from '@/lib/validation/common';
import { formatDate, formatDateTime, money } from '@/lib/client/format';
import type { PayoutStatus } from '@/lib/prisma';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { PayoutRequestForm, PayoutWithdrawButton } from '@/components/seller/payout-request-form';

/**
 * `GET /seller/payouts`
 *
 * The wallet page exists to answer one question without a spreadsheet: which money is mine, and
 * when can I move it. Everything here is read from the ledger — the seller never types an amount,
 * because the figure is a property of delivered orders, not of what they remember selling.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Payouts', robots: { index: false } };

const STATUS_TONE: Record<PayoutStatus, BadgeTone> = {
  REQUESTED: 'info',
  APPROVED: 'warning',
  SENT: 'success',
  FAILED: 'danger',
  REVERSED: 'danger',
};

const STATUS_NOTE: Record<PayoutStatus, string> = {
  REQUESTED: 'Finance has it in the queue.',
  APPROVED: 'Approved — the transfer is booked and leaves today.',
  SENT: 'Sent. Check the number below matches what you received.',
  FAILED: 'The transfer failed. Fix the account details below, then request the period again.',
  REVERSED: 'The money came back to us and is in your available balance again.',
};

const RAIL_LABEL: Record<string, string> = {
  MTN_MOMO: 'MTN Mobile Money',
  AIRTEL_MONEY: 'Airtel Money',
  BANK: 'Bank account',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card bg-ink-50 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="tabular mt-0.5 text-base font-semibold text-ink-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export default async function SellerPayoutsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { shop } = await sellerPage('/seller/payouts');
  const params = parseParams(pagination, searchParams);

  const [summary, history] = await Promise.all([payoutSummary(shop), payoutHistory(shop.id, { page: params.page, perPage: params.perPage })]);
  const hrefFor = (page: number) => hrefWith('/seller/payouts', { page, perPage: params.perPage }, { page });

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Payouts</h1>
            <p className="mt-1 max-w-prose text-sm text-ink-600">
              Delivered orders become withdrawable {summary.settlementDelayDays} days after they land, so a buyer who reports a problem is
              still covered. Cash a rider collected is yours in person and never appears in a payout.
            </p>
          </div>
          <Link href="/seller/shop" className="text-sm font-medium text-bemz-700 underline-offset-2 hover:underline">
            Payout account &amp; ID
          </Link>
        </div>

        <div className="mt-5 rounded-card bg-bemz-50 px-4 py-4 ring-1 ring-inset ring-bemz-200">
          <p className="text-xs font-medium uppercase tracking-wide text-bemz-700">Yours to withdraw now</p>
          <p className="tabular mt-1 text-3xl font-semibold text-bemz-900">{summary.availableLabel}</p>
          <p className="mt-1 text-xs text-bemz-800">
            {summary.clearedOrderCount === 0
              ? 'No paid, delivered order has finished its dispute window yet.'
              : `${summary.clearedOrderCount} delivered ${summary.clearedOrderCount === 1 ? 'order' : 'orders'} from ${formatDate(
                  summary.windowStart,
                )} onward.`}{' '}
            Anything already requested is held back, so this is {money(summary.withdrawableMinor, summary.currency)} you can actually move.
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Still clearing"
            value={money(summary.clearingMinor, summary.currency)}
            hint={`${summary.clearingOrderCount} delivered inside the ${summary.settlementDelayDays}-day window`}
          />
          <Stat
            label="Cash with riders"
            value={money(summary.cashWithRidersMinor, summary.currency)}
            hint={`${summary.cashParcelCount} parcel${summary.cashParcelCount === 1 ? '' : 's'} paid in cash — collect at the rider handover, it is not sent to you`}
          />
          <Stat
            label="Requested, not sent"
            value={money(summary.requestedMinor, summary.currency)}
            hint="Withheld from your balance until finance clears it"
          />
          <Stat
            label="Withdrawn all-time"
            value={money(summary.lifetimeWithdrawnMinor, summary.currency)}
            hint={`${summary.payoutCount} payout${summary.payoutCount === 1 ? '' : 's'} completed`}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-600">
          {summary.account ? (
            <>
              <Landmark className="h-4 w-4 text-ink-400" aria-hidden />
              <span>
                {RAIL_LABEL[summary.account.provider] ?? summary.account.provider}
                {summary.account.provider === 'BANK' && summary.account.bankName ? ` · ${summary.account.bankName}` : ''} ·{' '}
                <span className="tabular">{summary.account.accountNumber}</span> ({summary.account.accountName})
              </span>
              <Badge tone={summary.account.isVerified ? 'success' : 'warning'}>
                {summary.account.isVerified ? 'Confirmed' : 'Awaiting confirmation'}
              </Badge>
            </>
          ) : (
            <>
              <CircleDollarSign className="h-4 w-4 text-clay-600" aria-hidden />
              <span>No payout account yet.</span>
              <Link href="/seller/shop" className="font-medium text-bemz-700 underline-offset-2 hover:underline">
                Add the mobile money number to receive money
              </Link>
            </>
          )}
        </div>
      </section>

      <PayoutRequestForm
        currency={summary.currency}
        windowStart={summary.windowStart}
        windowEnd={summary.windowEnd}
        withdrawableMinor={summary.withdrawableMinor}
        minimumLabel={summary.minimumLabel}
        blockers={summary.blockers}
      />

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">How the figure is built</h2>
        <ul className="mt-2 space-y-1 text-sm text-ink-600">
          <li>· Merchandise total for orders delivered in the window, minus any discount and refunds.</li>
          <li>· Minus the commission Bemz held at checkout — the rate on each order row is the one that was used.</li>
          <li>· Plus the delivery fee only for parcels you delivered yourself; a Bemz rider cost the platform, not you.</li>
          <li>· Cash-on-delivery parcels are excluded entirely: the rider is holding that money, not us.</li>
        </ul>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Payout history</h2>
          <p className="text-xs text-ink-500">{history.total} request{history.total === 1 ? '' : 's'}</p>
        </div>

        {history.items.length === 0 ? (
          <EmptyState
            title="No payout requested yet"
            description="Once a period clears, request it above and finance sends it to your mobile money number within a working day."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {history.items.map((payout) => (
              <li key={payout.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular text-base font-semibold text-ink-900">{money(payout.amountMinor, payout.currency)}</span>
                    <Badge tone={STATUS_TONE[payout.status]}>{payout.status.replace('_', ' ').toLowerCase()}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {formatDate(payout.periodStart)} – {formatDate(payout.periodEnd)} · requested {formatDateTime(payout.createdAt)}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-600">{STATUS_NOTE[payout.status]}</p>
                  {payout.providerReference && (
                    <p className="tabular mt-0.5 text-xs text-ink-500">Transfer reference {payout.providerReference}</p>
                  )}
                  {payout.failureReason && <p className="mt-0.5 text-xs text-clay-800">Why: {payout.failureReason}</p>}
                  {payout.processedBy && (
                    <p className="mt-0.5 text-xs text-ink-400">
                      Handled by {payout.processedBy}
                      {payout.processedAt ? ` · ${formatDateTime(payout.processedAt)}` : ''}
                    </p>
                  )}
                  {!payout.account && <p className="mt-0.5 text-xs text-ink-400">The account on file changed after this request.</p>}
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  {payout.account && (
                    <p className="text-xs text-ink-500">
                      {RAIL_LABEL[payout.account.provider] ?? payout.account.provider}{' '}
                      <span className="tabular">{payout.account.accountNumber}</span>
                    </p>
                  )}
                  {payout.status === 'REQUESTED' && (
                    <PayoutWithdrawButton payoutId={payout.id} amountMinor={payout.amountMinor} currency={payout.currency} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <Pagination page={history.page} perPage={history.perPage} total={history.total} hrefFor={hrefFor} />
      </section>
    </div>
  );
}
