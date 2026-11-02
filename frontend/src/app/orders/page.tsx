import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Package } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/guards';
import { listOrders } from '@/lib/services/orders';
import { orderListQuerySchema } from '@/lib/validation/commerce';
import { hrefWith, parseParams } from '@/lib/catalog-params';
import { formatDate, money } from '@/lib/client/format';
import type { OrderStatus, OrderSummary } from '@/lib/client/types';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkButton } from '@/components/ui/link-button';
import { Pagination } from '@/components/ui/pagination';
import { StatusPill } from '@/components/ui/status-pill';

/**
 * `GET /orders`
 *
 * The list is filtered by links and a plain GET form, because "where is my parcel?" is asked on
 * the phone that received the delivery SMS, not on a desktop with the app open.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'My orders', description: 'Every order you placed on Bemz Africa.' };

const TABS: { label: string; status?: OrderStatus }[] = [
  { label: 'All orders' },
  { label: 'To pay', status: 'AWAITING_PAYMENT' },
  { label: 'To confirm', status: 'AWAITING_CONFIRMATION' },
  { label: 'On the way', status: 'OUT_FOR_DELIVERY' },
  { label: 'Delivered', status: 'DELIVERED' },
];

interface Props {
  searchParams: Record<string, string | string[] | undefined>;
}

export default async function OrdersPage({ searchParams }: Props) {
  const user = await getSessionUser();
  if (!user) redirect('/login?callbackUrl=%2Forders');

  const query = parseParams(orderListQuerySchema, searchParams);
  const { orders, total, page, perPage } = await listOrders(user, {
    status: query.status,
    q: query.q ?? null,
    page: query.page,
    perPage: query.perPage,
  });

  const hrefFor = (overrides: Record<string, string | number | undefined>) =>
    hrefWith('/orders', { status: query.status, q: query.q }, overrides);

  return (
    <div className="container-page space-y-5 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink-950">My orders</h1>
          <p className="mt-1 text-sm text-ink-600">
            {total.toLocaleString()} {total === 1 ? 'order' : 'orders'} · each shop ships its own parcel
          </p>
        </div>
        <form method="get" action="/orders" className="flex items-end gap-2">
          {query.status && <input type="hidden" name="status" value={query.status} />}
          <div>
            <label className="field-label" htmlFor="orders-q">
              Order or tracking number
            </label>
            <div className="flex gap-2">
              <input
                id="orders-q"
                name="q"
                type="search"
                defaultValue={query.q ?? ''}
                placeholder="UG24…"
                className="field-input"
              />
              <button type="submit" className="rounded-lg bg-bemz-600 px-3 text-sm font-semibold text-white hover:bg-bemz-700">
                Find
              </button>
            </div>
          </div>
        </form>
      </header>

      <nav className="flex flex-wrap gap-1.5" aria-label="Order status">
        {TABS.map((tab) => (
          <Link
            key={tab.label}
            href={hrefFor({ status: tab.status, page: undefined, q: query.q })}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              (tab.status ?? undefined) === (query.status ?? undefined)
                ? 'bg-bemz-600 font-semibold text-white'
                : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {orders.length === 0 ? (
        <EmptyState
          title={query.q ? 'No order matches that number' : 'No orders yet'}
          description={
            query.q
              ? 'Check the digits — tracking numbers start with the country code, order numbers with the market.'
              : 'When you order, the parcel, the tracking number and the receipt all live here.'
          }
          icon={<Package className="size-7" />}
          action={<LinkButton href="/search">Start shopping</LinkButton>}
        />
      ) : (
        <ul className="space-y-3">
          {orders.map((order) => (
            <li key={order.id}>
              <article className="card space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/orders/${order.id}`} className="tabular text-sm font-semibold text-ink-900 hover:text-bemz-700">
                        {order.orderNumber}
                      </Link>
                      <StatusPill status={order.status} />
                    </p>
                    <p className="mt-1 text-sm text-ink-600">
                      {order.shopName} · {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'} · placed{' '}
                      {formatDate(order.placedAt)}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {order.districtName ? `Delivering to ${order.districtName}` : 'Delivery district not recorded'}
                      {order.trackingNumber ? ` · tracking ${order.trackingNumber}` : ''}
                      {order.shipmentStatus !== 'UNASSIGNED' ? ` · ${order.shipmentStatus.replace(/_/g, ' ').toLowerCase()}` : ''}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="tabular text-base font-bold text-ink-900">{money(order.totalMinor, order.currency)}</p>
                    <p className={`text-xs ${paymentCaption(order).tone}`}>{paymentCaption(order).text}</p>
                    <Link href={`/orders/${order.id}`} className="mt-1 inline-block text-xs font-medium text-bemz-700 hover:underline">
                      Open order
                    </Link>
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={page} perPage={perPage} total={total} hrefFor={(next) => hrefFor({ page: next === 1 ? undefined : next })} />
    </div>
  );
}

/**
 * What the money line says.
 *
 * `amountPaidMinor` cannot answer this on its own: a cash-on-delivery parcel legitimately shows
 * zero paid while it is still live, and saying "UGX 0 paid" next to an order the buyer has not
 * been charged for reads like a failed payment.
 */
function paymentCaption(order: OrderSummary): { text: string; tone: string } {
  if (order.status === 'AWAITING_PAYMENT') return { text: 'Awaiting payment', tone: 'text-clay-700' };
  if (order.status === 'AWAITING_CONFIRMATION') return { text: 'Confirm, then pay the rider', tone: 'text-clay-700' };
  if (order.refundedMinor > 0)
    return { text: `${money(order.refundedMinor, order.currency)} refunded`, tone: 'text-clay-700' };
  if (order.status === 'CANCELLED' || order.status === 'FAILED') return { text: 'Closed', tone: 'text-ink-500' };
  return { text: 'Paid', tone: 'text-bemz-700' };
}
