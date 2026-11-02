import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CheckCircle2, Package, ReceiptText } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/guards';
import { loadOrderGroup } from '@/lib/services/orders';
import { pageData } from '@/lib/page-data';
import { formatCountdown, formatDate, money } from '@/lib/client/format';
import { LinkButton } from '@/components/ui/link-button';
import { StatusPill } from '@/components/ui/status-pill';
import { ListingImage } from '@/components/ui/listing-image';
import { PaymentStatus } from '@/components/order/payment-status';
import { CashOnDeliveryConfirm } from '@/components/order/cod-confirm';

/**
 * `GET /checkout/[groupId]`
 *
 * The page a buyer lands on after the MoMo prompt, so its job is to answer one question in plain
 * terms: is the money in, and what happens next. One group can be several shops, and each shop
 * packs and delivers its own parcel — the order numbers below are what a rider or support agent
 * asks for.
 */
export const dynamic = 'force-dynamic';

interface Props {
  params: { groupId: string };
}

export default async function CheckoutReceiptPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/checkout/${params.groupId}`)}`);

  const group = await pageData(loadOrderGroup(params.groupId, user));

  const cashOrders = group.orders.filter((order) => order.payments.some((payment) => payment.provider === 'CASH_ON_DELIVERY'));
  const onlinePayment = group.orders.flatMap((order) => order.payments).find((payment) => payment.provider !== 'CASH_ON_DELIVERY') ?? null;
  const allPaid = group.orders.every((order) => order.status !== 'AWAITING_PAYMENT');

  return (
    <div className="container-page max-w-3xl space-y-5 py-8">
      <header className="card space-y-3 p-6 text-center">
        <CheckCircle2 className={`mx-auto size-10 ${allPaid ? 'text-bemz-600' : 'text-clay-500'}`} aria-hidden />
        <h1 className="text-2xl font-bold text-ink-950">
          {allPaid ? 'Order placed' : 'Almost there — finish the payment'}
        </h1>
        <p className="text-sm text-ink-600">
          Group reference <span className="tabular font-semibold text-ink-900">{group.reference}</span> ·{' '}
          {money(group.totalMinor, group.currency)} · placed {formatDate(group.createdAt)}
        </p>
        <p className="text-sm text-ink-600">
          {group.orders.length === 1
            ? 'One shop is packing your parcel.'
            : `${group.orders.length} shops are packing separate parcels — each has its own tracking number.`}
        </p>
        <div className="flex flex-wrap justify-center gap-2 pt-1">
          <LinkButton href="/orders" variant="outline" size="sm">
            <Package className="size-4" />
            My orders
          </LinkButton>
          <LinkButton href="/search" size="sm">
            Keep shopping
          </LinkButton>
        </div>
      </header>

      {onlinePayment && (
        <PaymentStatus
          paymentId={onlinePayment.id}
          provider={onlinePayment.provider}
          currency={group.currency}
          amountMinor={onlinePayment.amountMinor}
          initialStatus={onlinePayment.status}
        />
      )}

      {cashOrders.length > 0 && (
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold text-ink-900">Cash on delivery</h2>
          <p className="text-sm text-ink-600">
            Nothing is charged now. Confirm each order below with an SMS code, then hand the money to the rider when
            the parcel arrives.
          </p>
          <div className="space-y-4">
            {cashOrders.map((order) => (
              <div key={order.id} className="rounded-card border border-ink-200 p-4">
                <p className="text-sm font-semibold text-ink-900">
                  {order.orderNumber} · {order.shop.name}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'} · {money(order.totalMinor, group.currency)} due on arrival
                  {order.expiresAt ? ` · confirm within ${formatCountdown(order.expiresAt)}` : ''}
                </p>
                <div className="mt-3">
                  <CashOnDeliveryConfirm orderId={order.id} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        {group.orders.map((order) => (
          <article key={order.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <ReceiptText className="size-4 text-ink-400" aria-hidden />
                  <Link href={`/orders/${order.id}`} className="tabular hover:text-bemz-700">
                    {order.orderNumber}
                  </Link>
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  <Link href={`/shop/${order.shop.slug}`} className="font-medium text-ink-700 hover:text-bemz-700">
                    {order.shop.name}
                  </Link>
                  {order.trackingNumber ? ` · tracking ${order.trackingNumber}` : ''}
                </p>
              </div>
              <StatusPill status={order.status} />
            </div>

            <ul className="divide-y divide-ink-100">
              {order.items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-3">
                  <ListingImage src={item.imageUrl} alt={item.productTitle} className="size-12 shrink-0 rounded-lg" sizes="48px" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{item.productTitle}</p>
                    <p className="text-xs text-ink-500">
                      {item.variantName} · quantity {item.quantity}
                    </p>
                  </div>
                  <span className="tabular text-sm text-ink-800">{money(item.totalMinor, group.currency)}</span>
                </li>
              ))}
            </ul>

            <div className="space-y-1 border-t border-ink-200 px-4 py-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-ink-500">Items</span>
                <span className="tabular text-ink-800">{money(order.subtotalMinor, group.currency)}</span>
              </div>
              {order.discountMinor > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-ink-500">Discount</span>
                  <span className="tabular text-bemz-700">−{money(order.discountMinor, group.currency)}</span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span className="text-ink-500">Delivery</span>
                <span className="tabular text-ink-800">{money(order.shippingFeeMinor, group.currency)}</span>
              </div>
              <div className="flex justify-between gap-3 pt-1">
                <span className="font-semibold text-ink-900">This parcel</span>
                <span className="tabular font-bold text-ink-900">{money(order.totalMinor, group.currency)}</span>
              </div>
              {order.expiresAt && !allPaid && (
                <p className="pt-1 text-xs text-clay-700">
                  Held for the parcel for {formatCountdown(order.expiresAt)} — stock is reserved until then.
                </p>
              )}
            </div>
          </article>
        ))}
      </section>

      <p className="px-1 text-xs leading-relaxed text-ink-500">
        Something wrong with the parcel? Open the order and use the dispute or return path there — the seller and Bemz
        both see the same history.{' '}
        <Link href="/orders" className="font-medium text-bemz-700 hover:underline">
          All my orders
        </Link>
      </p>
    </div>
  );
}
