import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { adminPage } from '@/lib/admin-page';
import { adminPayoutQueue, payoutLedger } from '@/lib/services/payouts';
import { parseParams, hrefWith } from '@/lib/catalog-params';
import { payoutListQuerySchema } from '@/lib/validation/commerce';
import { PAYOUT_STATUSES } from '@/lib/validation/enums';
import { formatDate, formatDateTime, money } from '@/lib/client/format';
import type { PayoutStatus } from '@/lib/prisma';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { PayoutActions } from '@/components/admin/payout-actions';

/**
 * `GET /admin/payouts`
 *
 * The last screen in this product where a person decides that money leaves the platform. Two
 * separate jobs are kept visibly apart: the queue is what needs a decision today, the ledger is
 * the flat window an accountant exports. Neither one can move cash by itself — the transfer is
 * made in the mobile-money operator portal and booked back here against its own reference, so a
 * double tap cannot become a double payment.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Payouts — finance', robots: { index: false } };

const STATUS_TONE: Record<PayoutStatus, BadgeTone> = {
  REQUESTED: 'info',
  APPROVED: 'warning',
  SENT: 'success',
  FAILED: 'danger',
  REVERSED: 'danger',
};

const KYC_TONE: Record<string, BadgeTone> = {
  NOT_SUBMITTED: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

const RAIL_LABEL: Record<string, string> = {
  MTN_MOMO: 'MTN MoMo',
  AIRTEL_MONEY: 'Airtel Money',
  BANK: 'Bank',
};

const LEDGER_WINDOWS = [7, 30, 90] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function first(raw: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * `payoutLedger` filters on `createdAt` between two instants, so a day typed into the form has to
 * be expanded to cover the whole of it — otherwise the last day of the window silently drops the
 * afternoon requests, which is exactly the range a finance person re-runs to check a total.
 */
function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dayEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function Chip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'rounded-lg bg-bemz-600 px-3 py-1.5 text-sm font-semibold text-white'
          : 'rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-bemz-400'
      }
    >
      {label}
    </Link>
  );
}

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await adminPage('/admin/payouts');

  const query = parseParams(payoutListQuerySchema, searchParams);
  const status = query.status;

  const queue = await adminPayoutQueue({
    ...(status ? { status } : {}),
    page: query.page,
    perPage: query.perPage,
  });

  // The ledger is read only when its own keys are present, so the default view of this page is the
  // queue and nothing else; a finance export is a deliberate second query.
  const ledgerFromRaw = first(searchParams, 'ledgerFrom');
  const ledgerToRaw = first(searchParams, 'ledgerTo');
  const ledgerStatusRaw = first(searchParams, 'ledgerStatus');
  const showLedger = DATE_ONLY.test(ledgerFromRaw ?? '') && DATE_ONLY.test(ledgerToRaw ?? '');

  const ledgerFrom = showLedger ? (ledgerFromRaw as string) : undefined;
  const ledgerTo = showLedger ? (ledgerToRaw as string) : undefined;
  const ledgerStatus = (PAYOUT_STATUSES as readonly string[]).includes(ledgerStatusRaw ?? '')
    ? (ledgerStatusRaw as PayoutStatus)
    : undefined;
  const ledger = showLedger
    ? await payoutLedger({ from: dayStart(ledgerFrom as string), to: dayEnd(ledgerTo as string), ...(ledgerStatus ? { status: ledgerStatus } : {}) })
    : null;

  const hrefFor = (page: number) =>
    hrefWith(
      '/admin/payouts',
      { status, page: query.page, perPage: query.perPage, ledgerFrom, ledgerTo, ledgerStatus },
      { page },
    );

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h1 className="text-xl font-semibold text-ink-900">Payouts</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-600">
          Sellers choose a period, never an amount — the figure was computed from delivered, paid,
          non-cash orders when they asked. What is on this page is a judgement: does the account
          match the ID, and has the window already been paid?
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Chip href={hrefWith('/admin/payouts', { page: query.page, perPage: query.perPage }, { status: undefined, page: 1 })} active={!status} label="Waiting on a decision" />
          {PAYOUT_STATUSES.map((value) => (
            <Chip
              key={value}
              href={hrefWith('/admin/payouts', { page: query.page, perPage: query.perPage }, { status: value, page: 1 })}
              active={status === value}
              label={value.replace('_', ' ').toLowerCase()}
            />
          ))}
        </div>

        <div className="mt-4 rounded-card bg-ink-50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Open against the platform</p>
          <p className="tabular mt-1 text-2xl font-semibold text-ink-900">
            {queue.openCount} request{queue.openCount === 1 ? '' : 's'}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            REQUESTED and APPROVED together, which is what the platform still owes. Their{' '}
            <span className="tabular">{queue.openTotalMinor.toLocaleString('en-US')}</span> is the same
            rows added up in minor units and <strong>mixes currencies</strong> — UGX, KES and USD cents
            cannot be spent as one number, so read amounts per row or filter a currency before
            totalling.
          </p>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            {status ? `${status.replace('_', ' ').toLowerCase()} requests` : 'Requests waiting on a decision'}
          </h2>
          <p className="text-xs text-ink-500">
            {queue.total} row{queue.total === 1 ? '' : 's'} · oldest first, because a request that has been
            sitting longest is the one the seller is asking about
          </p>
        </div>

        {queue.items.length === 0 ? (
          <EmptyState
            title={status ? `Nothing is ${status.replace('_', ' ').toLowerCase()}` : 'Nothing is waiting'}
            description={
              status
                ? 'Change the filter above to look at another stage of the pipeline.'
                : 'No seller has requested a period that finance has not already acted on. That is a good morning.'
            }
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {queue.items.map((payout) => {
              const kycBlocked = payout.shop.kycStatus !== 'APPROVED';
              return (
                <li key={payout.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="tabular text-lg font-semibold text-ink-900">
                          {money(payout.amountMinor, payout.currency)}
                        </span>
                        <Badge tone={STATUS_TONE[payout.status]}>{payout.status.replace('_', ' ').toLowerCase()}</Badge>
                        {kycBlocked && (
                          <Badge tone="danger">
                            <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                            KYC {payout.shop.kycStatus.replace('_', ' ').toLowerCase()}
                          </Badge>
                        )}
                        {payout.shop.status !== 'ACTIVE' && (
                          <Badge tone="warning">stall {payout.shop.status.replace('_', ' ').toLowerCase()}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-ink-700">
                        <Link href={`/admin/shops/${payout.shop.id}`} className="font-medium text-bemz-700 underline-offset-2 hover:underline">
                          {payout.shop.name}
                        </Link>{' '}
                        ·{' '}
                        <Link href={`/shop/${payout.shop.slug}`} className="text-ink-500 underline-offset-2 hover:underline">
                          public page
                        </Link>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        Period {formatDate(payout.periodStart)} – {formatDate(payout.periodEnd)} · requested{' '}
                        {formatDateTime(payout.createdAt)}
                      </p>
                    </div>

                    <div className="min-w-0 text-right text-xs text-ink-500">
                      {payout.account ? (
                        <p className="tabular">
                          {RAIL_LABEL[payout.account.provider] ?? payout.account.provider}{' '}
                          {payout.account.bankName ? `· ${payout.account.bankName} ` : ''}
                          {payout.account.accountNumber}
                        </p>
                      ) : (
                        <p className="text-clay-700">No payout account on file — the request cannot be paid.</p>
                      )}
                      {payout.account && <p>Account name: {payout.account.accountName}</p>}
                      {payout.providerReference && <p className="tabular">Portal ref {payout.providerReference}</p>}
                      {payout.failureReason && <p className="text-clay-800">{payout.failureReason}</p>}
                      {payout.processedBy && (
                        <p>
                          {payout.processedBy}
                          {payout.processedAt ? ` · ${formatDateTime(payout.processedAt)}` : ''}
                        </p>
                      )}
                    </div>
                  </div>

                  {kycBlocked && (
                    <p className="mt-2 rounded-card bg-clay-50 px-3 py-2 text-xs text-clay-800">
                      The server refuses approval until this seller&rsquo;s documents are approved. Clear the{' '}
                      <Link href={`/admin/queues?tab=kyc`} className="font-medium underline underline-offset-2">
                        ID queue
                      </Link>{' '}
                      first — paying out an unverified identity is how a marketplace ends up funding one.
                    </p>
                  )}

                  <div className="mt-3">
                    <PayoutActions
                      payoutId={payout.id}
                      status={payout.status}
                      amountMinor={payout.amountMinor}
                      currency={payout.currency}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <Pagination page={queue.page} perPage={queue.perPage} total={queue.total} hrefFor={hrefFor} />
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Ledger by date</h2>
        <p className="mt-1 max-w-prose text-xs text-ink-600">
          Flat rows for the accounting sheet, filtered by when the request was made rather than when it
          was paid. Every currency and every status appears, including the ones a seller later withdrew.
        </p>

        <form method="get" action="/admin/payouts" className="mt-3 flex flex-wrap items-end gap-3">
          {status && <input type="hidden" name="status" value={status} />}
          <div>
            <label className="field-label" htmlFor="ledgerFrom">
              From
            </label>
            <input id="ledgerFrom" name="ledgerFrom" type="date" defaultValue={ledgerFrom ?? isoDay(30)} className="field-input" />
          </div>
          <div>
            <label className="field-label" htmlFor="ledgerTo">
              To
            </label>
            <input id="ledgerTo" name="ledgerTo" type="date" defaultValue={ledgerTo ?? isoDay(0)} className="field-input" />
          </div>
          <div>
            <label className="field-label" htmlFor="ledgerStatus">
              Status
            </label>
            <select id="ledgerStatus" name="ledgerStatus" defaultValue={ledgerStatus ?? ''} className="field-input">
              <option value="">All</option>
              {PAYOUT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-card border border-ink-300 px-3 py-2 text-sm font-medium text-ink-800 hover:border-bemz-400"
          >
            Run
          </button>
          {/* A GET form submits every control in it whichever button is pressed, so "clear" has to
              be a link rather than a second submit. */}
          {showLedger && (
            <Link
              href={hrefWith('/admin/payouts', { status, perPage: query.perPage }, { page: query.page })}
              className="rounded-card px-3 py-2 text-sm text-ink-500 hover:text-ink-800"
            >
              Hide the export
            </Link>
          )}
        </form>

        <div className="mt-2 flex flex-wrap gap-2">
          {LEDGER_WINDOWS.map((days) => (
            <Link
              key={days}
              href={hrefWith(
                '/admin/payouts',
                { status, perPage: query.perPage, ledgerStatus },
                { ledgerFrom: isoDay(days - 1), ledgerTo: isoDay(0) },
              )}
              className="rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-700 hover:border-bemz-400"
            >
              Last {days} days
            </Link>
          ))}
        </div>

        {ledger === null ? (
          <p className="mt-3 text-xs text-ink-500">Pick a range to load the export.</p>
        ) : ledger.length === 0 ? (
          <p className="mt-3 text-xs text-ink-500">No payout was requested in that window.</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                    <th className="py-2 pr-3 font-medium">Requested</th>
                    <th className="py-2 pr-3 font-medium">Shop</th>
                    <th className="py-2 pr-3 text-right font-medium">Amount</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Paid to</th>
                    <th className="py-2 pr-3 font-medium">Portal reference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {ledger.map((row) => (
                    <tr key={row.payoutId}>
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-ink-500">{formatDateTime(row.createdAt)}</td>
                      <td className="py-2 pr-3">
                        {/* The ledger projection carries the slug, not the id, so this goes to the
                            buyer-facing page — the case file is one click away from the queue above. */}
                        <Link href={`/shop/${row.shopSlug}`} className="text-bemz-700 underline-offset-2 hover:underline">
                          {row.shop}
                        </Link>
                      </td>
                      <td className="tabular py-2 pr-3 text-right">{money(row.amountMinor, row.currency)}</td>
                      <td className="py-2 pr-3 text-xs text-ink-600">{row.status.replace('_', ' ').toLowerCase()}</td>
                      <td className="tabular py-2 pr-3 text-xs text-ink-500">
                        {RAIL_LABEL[row.provider] ?? row.provider} {row.accountNumber}
                        {row.bankName ? ` (${row.bankName})` : ''}
                      </td>
                      <td className="tabular py-2 pr-3 text-xs text-ink-500">
                        {row.providerReference ?? row.failureReason ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              {ledger.length} row{ledger.length === 1 ? '' : 's'} between {ledgerFrom} and {ledgerTo}.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
