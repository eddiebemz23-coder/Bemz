import type { Metadata } from 'next';
import Link from 'next/link';
import { Truck } from 'lucide-react';
import { sellerPage } from '@/lib/seller-page';
import { listOrders, sellerOrderStats } from '@/lib/services/orders';
import { orderListQuerySchema } from '@/lib/validation/commerce';
import { hrefWith, parseParams } from '@/lib/catalog-params';
import { displayPhone, formatCountdown, formatDate, money, paymentLabel } from '@/lib/client/format';
import { REGIONS, regionForCurrency } from '@/lib/client/regions';
import type { OrderStatus } from '@/lib/client/types';
// The queue row needs the buyer's phone and the payment line, which only the server-side summary
// carries — a type-only import, so nothing of `server-only` reaches the browser bundle.
import type { OrderSummary } from '@/lib/services/orders';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Pagination } from '@/components/ui/pagination';
import { StatusPill } from '@/components/ui/status-pill';
import { CancelOrderForm } from '@/components/order/cancel-order-form';
import { SellerOrderControls } from '@/components/seller/order-controls';

/**
 * `GET /seller/orders`
 *
 * The queue is ordered by what a seller has to do, not by when the order happened: an unpaid
 * confirmation SMS and a parcel that has sat packed for two days both cost money, so the default
 * view is everything still open and each row carries the one action that moves it forward.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Orders · Bemz seller', robots: { index: false } };

const TABS: { label: string; status?: OrderStatus }[] = [
  { label: 'Open queue' },
  { label: 'Awaiting confirmation', status: 'AWAITING_CONFIRMATION' },
  { label: 'To pack', status: 'CONFIRMED' },
  { label: 'Packed', status: 'PACKED' },
  { label: 'With a rider', status: 'OUT_FOR_DELIVERY' },
  { label: 'Delivered', status: 'DELIVERED' },
  { label: 'Cancelled', status: 'CANCELLED' },
];

/** Mirrors `SELLER_CANCELLABLE` in the order service — the button only appears where it works. */
const SELLER_MAY_CANCEL: OrderStatus[] = ['AWAITING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED'];

interface Props {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function SellerOrdersPage({ searchParams }: Props) {
  const { user, shop } = await sellerPage('/seller/orders');
  const query = parseParams(orderListQuerySchema, searchParams);

  const [{ orders, total, page, perPage }, stats] = await Promise.all([
    listOrders(user, {
      // The service pins a seller's read to their own shops whatever is typed into the URL.
      shopId: shop.id,
      status: query.status,
      q: query.q ?? null,
      from: query.from,
      to: query.to,
      page: query.page,
      perPage: query.perPage,
    }),
    sellerOrderStats(shop.id),
  ]);

  const hrefFor = (overrides: Record<string, string | number | undefined>) =>
    hrefWith('/seller/orders', { status: query.status, q: query.q, from: query.from, to: query.to }, overrides);

  const countFor = (status?: OrderStatus) => (status ? (stats.statuses[status]?.count ?? 0) : undefined);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-950">Orders</h1>
          <p className="mt-1 text-sm text-ink-600">
            {total.toLocaleString()} {total === 1 ? 'order' : 'orders'}
            {query.status ? ` in ${labelOf(query.status)}` : ' still open'} · {shop.name}
          </p>
        </div>

        <form method="get" action="/seller/orders" className="flex items-end gap-2">
          {query.status && <input type="hidden" name="status" value={query.status} />}
          <div>
            <label className="field-label" htmlFor="seller-orders-q">
              Order, tracking or buyer phone
            </label>
            <div className="flex gap-2">
              <input
                id="seller-orders-q"
                name="q"
                type="search"
                defaultValue={query.q ?? ''}
                placeholder="UG24… or 077…"
                className="field-input"
              />
              <button type="submit" className="rounded-lg bg-bemz-600 px-3 text-sm font-semibold text-white hover:bg-bemz-700">
                Find
              </button>
            </div>
          </div>
        </form>
      </header>

      <nav className="flex flex-wrap gap-1.5" aria-label="Order queue">
        {TABS.map((tab) => {
          const active = (tab.status ?? undefined) === (query.status ?? undefined);
          const count = countFor(tab.status);
          return (
            <Link
              key={tab.label}
              href={hrefFor({ status: tab.status, page: undefined, q: query.q })}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                active ? 'bg-bemz-600 font-semibold text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
              }`}
            >
              {tab.label}
              {count !== undefined && count > 0 && (
                <span className={`tabular rounded-full px-1.5 text-xs ${active ? 'bg-white/20' : 'bg-white text-ink-600'}`}>{count}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {orders.length === 0 ? (
        <EmptyState
          icon={<Truck className="size-7" />}
          title={query.q ? 'No order matches that search' : 'Nothing waiting'}
          description={
            query.q
              ? 'Order numbers, tracking numbers and the buyer’s phone number all work here.'
              : 'New orders appear the moment a buyer checks out. Confirm them quickly — the dispatch promise starts counting now.'
          }
          action={
            <Link href="/seller/products" className="text-sm font-semibold text-bemz-700 hover:underline">
              Check your listings
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <OrderRow order={order} />
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={page}
        perPage={perPage}
        total={total}
        hrefFor={(next) => hrefFor({ page: next === 1 ? undefined : next })}
      />
    </div>
  );
}

function labelOf(status: OrderStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

/**
 * One row, one job.
 *
 * The buyer's phone is a `tel:` link because the first thing a seller does with an unusual order
 * is call, and the countdown is the platform's, not the seller's — past it the order expires and
 * the reservation is released without them.
 */
function OrderRow({ order }: { order: OrderSummary }) {
  const region = REGIONS[regionForCurrency(order.currency)];
  const contactPhone = order.recipientPhone ?? order.buyerPhone;
  const isCod = order.paymentProvider === 'CASH_ON_DELIVERY';
  const awaitingCash = isCod && order.status !== 'DELIVERED' && order.status !== 'CANCELLED';
  const stockConsumed = order.status === 'PACKED' || order.status === 'OUT_FOR_DELIVERY' || order.status === 'DELIVERED';

  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <Link href={`/orders/${order.id}`} className="tabular text-sm font-semibold text-ink-900 hover:text-bemz-700">
              {order.orderNumber}
            </Link>
            <StatusPill status={order.status} />
            {order.paymentProvider && <Badge tone={order.paymentStatus === 'SUCCEEDED' ? 'success' : 'neutral'}>{paymentLabel(order.paymentProvider)}</Badge>}
          </p>
          <p className="mt-1 text-sm text-ink-700">
            {order.buyerName ?? 'A buyer without a name'}{' '}
            {contactPhone && (
              <a
                href={`tel:${contactPhone}`}
                className="tabular ml-1 text-bemz-700 underline decoration-bemz-200 underline-offset-2 hover:decoration-bemz-600"
              >
                {displayPhone(contactPhone, region.dialCode)}
              </a>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'} · placed {formatDate(order.placedAt, 'long')}
            {order.districtName ? ` · delivering to ${order.districtName}` : ''}
            {order.recipientName && order.recipientName !== order.buyerName ? ` · for ${order.recipientName}` : ''}
          </p>
          {order.trackingNumber && <p className="tabular mt-0.5 text-xs text-ink-500">Tracking {order.trackingNumber}</p>}
        </div>

        <div className="text-right">
          <p className="tabular text-base font-bold text-ink-900">{money(order.totalMinor, order.currency)}</p>
          <p className="text-xs text-ink-500">You keep {money(order.totalMinor - order.platformFeeMinor - order.shippingFeeMinor, order.currency)}</p>
          <p className={`mt-0.5 text-xs ${isCod ? 'text-clay-700' : 'text-bemz-700'}`}>
            {isCod ? 'Buyer pays the rider on delivery' : `Paid ${money(order.amountPaidMinor, order.currency)}`}
          </p>
          {order.expiresAt && (
            <p className="mt-1 text-xs font-medium text-clay-700">Closes in {formatCountdown(order.expiresAt)}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-ink-100 pt-3">
        <SellerOrderControls orderId={order.id} status={order.status} trackingNumber={order.trackingNumber} />
        <div className="flex flex-wrap items-center gap-3">
          {awaitingCash && (
            <p className="text-xs text-ink-500">
              {money(order.totalMinor, order.currency)} is with the rider until you mark it delivered.
            </p>
          )}
          {stockConsumed && order.status !== 'DELIVERED' && (
            <p className="text-xs text-ink-500">Units already off your stock.</p>
          )}
          <Link href={`/orders/${order.id}`} className="text-xs font-medium text-ink-600 hover:text-bemz-700">
            Full receipt
          </Link>
          {SELLER_MAY_CANCEL.includes(order.status) && <CancelOrderForm orderId={order.id} canRestock />}
        </div>
      </div>
    </article>
  );
}
