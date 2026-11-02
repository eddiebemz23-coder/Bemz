import type { Metadata } from 'next';
import Link from 'next/link';
import { adminPage } from '@/lib/admin-page';
import { adminUserCase } from '@/lib/services/moderation';
import { pageData } from '@/lib/page-data';
import { formatDate, formatDateTime, humanise, money, paymentLabel } from '@/lib/client/format';
import type { CurrencyCode } from '@/lib/money';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { AdminDecisionForm } from '@/components/admin/decision-form';

/**
 * `GET /admin/users/[userId]`
 *
 * The support file behind every "my account is frozen" message. It answers the four questions an
 * operator is actually asked — who is this, what did they sell, is anything still moving, and what
 * can I legitimately do to them — and nothing else. There is deliberately no credential on this
 * page: no password, no OTP code, no session token, because a screen that can read one is how a
 * screenshot becomes a breach.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Account case file', robots: { index: false } };

const ACCOUNT_TONE: Record<string, BadgeTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  BANNED: 'danger',
  PENDING_VERIFICATION: 'info',
};

const SHOP_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CLOSED: 'neutral',
};

const ROLE_LABEL: Record<string, string> = { BUYER: 'Buyer', SELLER: 'Seller', ADMIN: 'Platform team' };

const KYC_TONE: Record<string, BadgeTone> = {
  NOT_SUBMITTED: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

const PAYMENT_TONE: Record<string, BadgeTone> = {
  INITIATED: 'info',
  PENDING_CUSTOMER: 'warning',
  PROCESSING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  REFUNDED: 'danger',
  PARTIALLY_REFUNDED: 'warning',
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-900">{value}</dd>
    </div>
  );
}

export default async function AdminUserCasePage({
  params,
}: {
  params: { userId: string };
}) {
  await adminPage(`/admin/users/${params.userId}`);
  const detail = await pageData(adminUserCase(params.userId));
  const { account, shops, orders, recentPayments } = detail;

  const name = account.name ?? 'Account with no name';
  const isStaff = account.role === 'ADMIN';
  const dialTarget = account.phone ? `tel:${account.phone.replace(/[^+\d]/g, '')}` : null;

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <Link href="/admin/audit" className="text-xs font-medium text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline">
          ← Audit trail
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink-900">{name}</h1>
          <Badge tone={ACCOUNT_TONE[account.status] ?? 'neutral'}>{humanise(account.status)}</Badge>
          <Badge tone="neutral">{ROLE_LABEL[account.role] ?? humanise(account.role)}</Badge>
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Joined {formatDate(account.createdAt)} ·{' '}
          {account.lastLoginAt ? `last signed in ${formatDateTime(account.lastLoginAt)}` : 'has never signed in'}
        </p>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">Phone</dt>
            <dd className="mt-0.5 text-sm">
              {account.phone ? (
                dialTarget ? (
                  <a href={dialTarget} className="tabular text-bemz-700 underline-offset-2 hover:underline">
                    {account.phone}
                  </a>
                ) : (
                  <span className="tabular">{account.phone}</span>
                )
              ) : (
                <span className="text-ink-400">No phone on file</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">Email</dt>
            <dd className="mt-0.5 text-sm">
              {account.email ? (
                <a href={`mailto:${account.email}`} className="text-bemz-700 underline-offset-2 hover:underline">
                  {account.email}
                </a>
              ) : (
                <span className="text-ink-400">Signed in with a phone number only</span>
              )}
            </dd>
          </div>
          <Fact label="Country" value={account.country ? `${account.country.name} (${account.country.code})` : 'Not set'} />
          <Fact label="Quotes prices in" value={account.preferredCurrency} />
        </dl>

        <p className="mt-4 text-xs text-ink-500">
          This is everything the platform can show about a person. Password hash, one-time codes and
          session tokens are never readable here — an operator who needs to reset access sends the
          reset flow, they do not look at the credential.
        </p>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Activity</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-card bg-ink-50 px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Orders placed</p>
            <p className="tabular mt-0.5 text-base font-semibold text-ink-900">{orders.placed}</p>
            <p className="mt-0.5 text-xs text-ink-500">{orders.inFlight} still on the way</p>
          </div>
          <div className="rounded-card bg-ink-50 px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Orders sold</p>
            <p className="tabular mt-0.5 text-base font-semibold text-ink-900">{orders.soldAsSeller}</p>
            <p className="mt-0.5 text-xs text-ink-500">Across {shops.length} stall{shops.length === 1 ? '' : 's'} they own</p>
          </div>
          <div className="rounded-card bg-ink-50 px-3 py-2.5">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Money attempts</p>
            <p className="tabular mt-0.5 text-base font-semibold text-ink-900">{recentPayments.length}</p>
            <p className="mt-0.5 text-xs text-ink-500">Most recent ten on orders they bought</p>
          </div>
        </div>

        {orders.inFlight > 0 && account.status !== 'ACTIVE' && (
          <p className="mt-3 rounded-card bg-clay-50 px-3 py-2 text-xs text-clay-800">
            {orders.inFlight} of their orders are still moving. Restricting the account stops them
            signing in but does not recall a parcel already on a motorbike — cancel those from the
            order page if the reason is fraud.
          </p>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Stalls they own</h2>
        </div>
        {shops.length === 0 ? (
          <EmptyState
            title="Never opened a stall"
            description="This account has only ever bought. Nothing here can be paused on the selling side."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {shops.map((shop) => (
              <li key={shop.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/shops/${shop.id}`}
                      className="truncate text-sm font-semibold text-bemz-700 underline-offset-2 hover:underline"
                    >
                      {shop.name}
                    </Link>
                    <Badge tone={SHOP_STATUS_TONE[shop.status] ?? 'neutral'}>{humanise(shop.status)}</Badge>
                    <Badge tone={KYC_TONE[shop.kycStatus] ?? 'neutral'}>KYC {humanise(shop.kycStatus)}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {shop.totalSalesCount} payout{shop.totalSalesCount === 1 ? '' : 's'} settled by finance ·{' '}
                    {shop.ratingAvg === null ? 'no ratings yet' : `${shop.ratingAvg.toFixed(1)} average`}
                  </p>
                </div>
                <Link href={`/shop/${shop.slug}`} className="text-xs text-ink-500 underline-offset-2 hover:underline">
                  see it as a buyer
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Payment attempts on their orders</h2>
          <p className="mt-1 text-xs text-ink-600">
            A pending row here is almost always a buyer who never finished the PIN prompt on their
            phone, not money that went missing. Cash-on-delivery orders never appear because no
            payment is ever started for them.
          </p>
        </div>
        {recentPayments.length === 0 ? (
          <p className="px-5 py-4 text-sm text-ink-500">No payment has ever been attempted on an order this account placed.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Rail</th>
                  <th className="py-2 pr-3 font-medium">State</th>
                  <th className="py-2 pr-5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {recentPayments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="px-5 py-2 text-xs text-ink-500">{formatDateTime(payment.createdAt)}</td>
                    <td className="py-2 pr-3">{paymentLabel(payment.provider)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={PAYMENT_TONE[payment.status] ?? 'neutral'}>{humanise(payment.status)}</Badge>
                    </td>
                    <td className="tabular py-2 pr-5 text-right">{money(Number(payment.amountMinor), payment.currency as CurrencyCode)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Restrict this account</h2>
        {isStaff ? (
          <p className="mt-2 max-w-prose text-sm text-ink-700">
            This is a platform-team account. There is no role above <span className="tabular">ADMIN</span> in
            this build, so the API refuses to suspend or ban one — an admin is taken out of the database
            by two people watching, not by a button a single colleague can press. Nothing about their
            orders, reviews or payouts is deleted either way, because a dispute trail has to keep
            pointing at a real person.
          </p>
        ) : (
          <>
            <p className="mt-2 max-w-prose text-sm text-ink-600">
              Suspension and a ban are both a status, not a deletion: the listings stay, the reviews
              stay, and payouts already sent stay paid. Their next request is refused at the guard, which
              re-reads this row — an existing signed-in session stops working on the next call rather than
              when it expires, because a token cannot be recalled.
            </p>
            <div className="mt-4">
              <AdminDecisionForm
                endpoint={`/api/admin/users/${account.id}`}
                method="PATCH"
                field="status"
                subject={name}
                choices={[
                  {
                    value: 'ACTIVE',
                    label: 'Restore access',
                    variant: 'primary',
                    hint: 'Clears a suspension or a ban. The account can sign in and check out again.',
                  },
                  {
                    value: 'SUSPENDED',
                    label: 'Suspend',
                    variant: 'secondary',
                    needsReason: true,
                    hint: 'Temporary. Use it while a dispute is being looked into.',
                  },
                  {
                    value: 'BANNED',
                    label: 'Ban',
                    variant: 'danger',
                    needsReason: true,
                    hint: 'Permanent. Their stalls are not closed by this — pause those from the stall page too.',
                  },
                ]}
              />
            </div>
          </>
        )}

        <p className="mt-4 text-xs text-ink-500">
          <Link
            href={`/admin/audit?actorId=${account.id}`}
            className="font-medium text-bemz-700 underline-offset-2 hover:underline"
          >
            Every decision this account has made
          </Link>{' '}
          — the same filter the dispute is argued from.
        </p>
      </section>
    </div>
  );
}
