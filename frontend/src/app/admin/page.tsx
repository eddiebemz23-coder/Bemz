import type { Metadata } from 'next';
import Link from 'next/link';
import { adminPage } from '@/lib/admin-page';
import { adminMetrics, adminStaff } from '@/lib/services/moderation';
import { parseParams, hrefWith } from '@/lib/catalog-params';
import { adminMetricsQuerySchema } from '@/lib/validation/commerce';
import { formatDateTime, fromBps, humanise, money, paymentLabel } from '@/lib/client/format';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';

/**
 * `GET /admin`
 *
 * The deck numbers, on the same path the rest of the site uses, computed by the same service the
 * REST route calls. GMV here is money the platform actually holds — an unpaid basket is not
 * revenue and a cancelled one never was, so neither can inflate the trend line.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Marketplace numbers', robots: { index: false } };

const WINDOWS = [7, 30, 90] as const;

const RAIL_TONE: Record<string, BadgeTone> = {
  MTN_MOMO: 'success',
  AIRTEL_MONEY: 'info',
  STRIPE_CARD: 'brand',
  CASH_ON_DELIVERY: 'warning',
};

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-card border border-ink-200 px-3 py-2.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={
          tone === 'good'
            ? 'tabular mt-0.5 text-xl font-semibold text-bemz-700'
            : tone === 'bad'
              ? 'tabular mt-0.5 text-xl font-semibold text-clay-700'
              : 'tabular mt-0.5 text-xl font-semibold text-ink-900'
        }
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

export default async function AdminOverviewPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await adminPage('/admin');
  const { days } = parseParams(adminMetricsQuerySchema, searchParams);

  const [metrics, staff] = await Promise.all([adminMetrics(days), adminStaff()]);
  const currency = metrics.currency;
  const railTotal = metrics.paymentMix.reduce((sum, rail) => sum + rail.minor, 0);

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-ink-900">Last {metrics.window.days} days</h1>
            <p className="mt-1 text-sm text-ink-600">
              Compared with {metrics.window.days} days before that. Quoted in {currency}, the currency most of these orders were paid in.
            </p>
          </div>
          <div className="flex gap-1.5" role="group" aria-label="Window">
            {WINDOWS.map((candidate) => (
              <Link
                key={candidate}
                href={hrefWith('/admin', { days: candidate }, { days: candidate })}
                aria-current={candidate === days ? 'page' : undefined}
                className={
                  candidate === days
                    ? 'rounded-lg bg-bemz-600 px-3 py-1.5 text-sm font-semibold text-white'
                    : 'rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-bemz-400'
                }
              >
                {candidate}d
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="GMV"
            value={money(metrics.gmv.minor, currency)}
            hint={
              metrics.gmv.deltaPct === null
                ? `No paid orders in the previous ${metrics.window.days} days to compare with`
                : `${metrics.gmv.deltaPct > 0 ? '+' : ''}${metrics.gmv.deltaPct}% against ${money(metrics.gmv.previousMinor, currency)}`
            }
            tone={metrics.gmv.deltaPct === null ? undefined : metrics.gmv.deltaPct >= 0 ? 'good' : 'bad'}
          />
          <Kpi
            label="Paid orders"
            value={metrics.gmv.orderCount.toLocaleString()}
            hint={`Average ${money(metrics.gmv.averageOrderMinor, currency)} per order`}
          />
          <Kpi
            label="Commission held"
            value={money(metrics.gmv.platformFeeMinor, currency)}
            hint={`Default rate ${fromBps(metrics.commissionBpsDefault)} — categories set their own`}
          />
          <Kpi
            label="Growth"
            value={`${metrics.growth.newShops} shops`}
            hint={`${metrics.growth.newBuyers} buyer accounts created`}
          />
          <Kpi
            label="Delivery collected"
            value={money(metrics.gmv.shippingMinor, currency)}
            hint="Paid to riders and the courier contract, not platform income"
          />
          <Kpi
            label="Seller discounts"
            value={money(metrics.gmv.discountsMinor, currency)}
            hint="Money sellers gave up to move stock"
          />
          <Kpi
            label="Cancellations"
            value={`${metrics.cancellations.count}`}
            hint={`${metrics.cancellations.ratePct}% of orders placed in the window`}
            tone={metrics.cancellations.ratePct > 10 ? 'bad' : undefined}
          />
          <Kpi
            label="Refunds paid"
            value={money(metrics.refunds.minor, currency)}
            hint={`${metrics.refunds.count} refund${metrics.refunds.count === 1 ? '' : 's'} succeeded`}
            tone={metrics.refunds.minor > 0 ? 'bad' : undefined}
          />
        </div>
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Needs a person</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          <li className="rounded-card bg-ink-50 px-3 py-2.5">
            <p className="tabular text-lg font-semibold text-ink-900">{metrics.alerts.productsAwaitingModeration}</p>
            <p className="text-xs text-ink-600">listings waiting for a first look</p>
            <Link href="/admin/queues" className="mt-1 inline-block text-xs font-medium text-bemz-700 hover:underline">
              Open the queue
            </Link>
          </li>
          <li className="rounded-card bg-ink-50 px-3 py-2.5">
            <p className="tabular text-lg font-semibold text-ink-900">{metrics.alerts.shopsAwaitingKyc}</p>
            <p className="text-xs text-ink-600">seller ID batches under review</p>
            <Link href="/admin/queues" className="mt-1 inline-block text-xs font-medium text-bemz-700 hover:underline">
              Open the queue
            </Link>
          </li>
          <li className="rounded-card bg-ink-50 px-3 py-2.5">
            <p className="tabular text-lg font-semibold text-ink-900">{metrics.alerts.expiredUnpaidOrders}</p>
            <p className="text-xs text-ink-600">
              unpaid orders past their hold, still reserving stock. The expiry job releases these; a growing number means it is not running.
            </p>
          </li>
        </ul>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Orders in the window, by status</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {metrics.ordersByStatus.map((row) => (
              <li key={row.status} className="flex items-center gap-2 rounded-full bg-ink-50 py-1 pl-1.5 pr-3">
                <StatusPill status={row.status} />
                <span className="tabular text-sm font-semibold text-ink-800">{row.count}</span>
              </li>
            ))}
            {metrics.ordersByStatus.length === 0 && <li className="text-sm text-ink-500">Nothing was ordered in these dates.</li>}
          </ul>

          <h3 className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-500">How the money arrived</h3>
          {metrics.paymentMix.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">No payment succeeded in this window.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {metrics.paymentMix.map((rail) => (
                <li key={rail.provider} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Badge tone={RAIL_TONE[rail.provider] ?? 'neutral'}>{paymentLabel(rail.provider)}</Badge>
                    <span className="text-xs text-ink-500">{rail.count} payment{rail.count === 1 ? '' : 's'}</span>
                  </span>
                  <span className="tabular text-sm text-ink-800">
                    {money(rail.minor, currency)}
                    {railTotal > 0 ? <span className="ml-1 text-xs text-ink-500">{Math.round((rail.minor / railTotal) * 100)}%</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            Cash on delivery counts in GMV but is not in the platform&rsquo;s account — it is with the rider until a parcel is marked
            delivered, and it never enters a payout.
          </p>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Who is on shift</h2>
          {staff.length === 0 ? (
            <p className="mt-2 text-sm text-ink-500">No admin accounts exist yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {staff.map((person) => (
                <li key={person.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Link href={`/admin/users/${person.id}`} className="font-medium text-ink-900 hover:text-bemz-700">
                      {person.name ?? 'Unnamed admin'}
                    </Link>
                    <Badge tone={person.status === 'ACTIVE' ? 'success' : 'danger'}>{humanise(person.status)}</Badge>
                  </span>
                  <span className="text-xs text-ink-500">{person.lastLoginAt ? formatDateTime(person.lastLoginAt) : 'never signed in'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-500">
            Check who else is working before you ban an account or refuse a payout — every decision is filed under your name in the audit
            trail, and a colleague can see it.
          </p>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="border-b border-ink-100 px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Top shops by GMV</h2>
          </div>
          {metrics.topShops.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-500">No shop has paid orders in this window.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {metrics.topShops.map((shop, index) => (
                <li key={shop.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                  <span className="min-w-0">
                    <span className="tabular mr-2 text-xs text-ink-400">{index + 1}</span>
                    <Link href={`/shop/${shop.slug}`} className="text-sm font-medium text-ink-900 hover:text-bemz-700">
                      {shop.name}
                    </Link>
                    <span className="ml-2 text-xs text-ink-500">{shop.orderCount} order{shop.orderCount === 1 ? '' : 's'}</span>
                  </span>
                  <span className="tabular text-sm text-ink-800">{money(shop.gmvMinor, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="border-b border-ink-100 px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Top listings</h2>
          </div>
          {metrics.topProducts.length === 0 ? (
            <p className="px-5 py-4 text-sm text-ink-500">Nothing sold in this window yet.</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {metrics.topProducts.map((product, index) => (
                <li key={product.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                  <span className="min-w-0">
                    <span className="tabular mr-2 text-xs text-ink-400">{index + 1}</span>
                    <Link href={`/product/${product.shopSlug}/${product.slug}`} className="text-sm font-medium text-ink-900 hover:text-bemz-700">
                      {product.title}
                    </Link>
                    <span className="ml-2 text-xs text-ink-500">{product.sold} sold</span>
                  </span>
                  <span className="tabular text-sm text-ink-800">{money(product.minor, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
