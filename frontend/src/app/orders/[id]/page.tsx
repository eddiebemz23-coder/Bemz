import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, BadgeCheck, CreditCard, MapPin, RotateCcw, Store, Truck } from 'lucide-react';
import { getSessionUser } from '@/lib/auth/guards';
import { getOrderDetail } from '@/lib/services/orders';
import { pageData } from '@/lib/page-data';
import { displayPhone, formatCountdown, formatDate, formatDateTime, humanise, money, paymentLabel } from '@/lib/client/format';
import type { OrderStatus } from '@/lib/client/types';
import { StatusPill } from '@/components/ui/status-pill';
import { ListingImage } from '@/components/ui/listing-image';
import { PaymentStatus } from '@/components/order/payment-status';
import { CashOnDeliveryConfirm } from '@/components/order/cod-confirm';
import { CancelOrderForm } from '@/components/order/cancel-order-form';
import { SellerOrderControls } from '@/components/seller/order-controls';

/**
 * `GET /orders/[id]`
 *
 * One order is one parcel from one shop — a basket of three shops is three of these pages under
 * one payment group. Everything on it comes from the order's own record, not from the live
 * catalog: the address is the JSON snapshot taken at checkout, so an edit to the address book
 * after the parcel left cannot rewrite where the rider was sent, and the item rows keep the title
 * and price that were charged even after the listing is deleted.
 *
 * The same page serves the seller and admin copy of the record (the service already proved the
 * viewer may read it), so the buyer-only actions are gated on `buyerId` rather than on the URL.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Order details', robots: { index: false } };

interface Props {
  params: { id: string };
}

/** The forward path of a parcel. `proves` is which statuses mean the stage has been reached. */
const STAGES: { label: string; proves: OrderStatus[] }[] = [
  { label: 'Placed', proves: ['AWAITING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
  { label: 'Confirmed', proves: ['CONFIRMED', 'PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
  { label: 'Packed', proves: ['PACKED', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
  { label: 'On the way', proves: ['OUT_FOR_DELIVERY', 'DELIVERED'] },
  { label: 'Delivered', proves: ['DELIVERED'] },
];

const CLOSED: OrderStatus[] = ['CANCELLED', 'REFUNDED', 'FAILED'];

/** Mirrors the service's own rule: a packed parcel is a rider's problem, not a cancellation. */
const SELLER_MAY_CANCEL: OrderStatus[] = ['AWAITING_PAYMENT', 'AWAITING_CONFIRMATION', 'CONFIRMED'];

export default async function OrderDetailPage({ params }: Props) {
  const user = await getSessionUser();
  if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/orders/${params.id}`)}`);

  const order = await pageData(getOrderDetail(params.id, user));
  const isBuyer = order.buyerId === user.id;

  // `allowedSellerTransitions` is only filled for the shop owner and for admin, so a non-empty list
  // is the proof that whoever is reading this is the one who has to pack the parcel.
  const mayActAsSeller = order.allowedSellerTransitions.length > 0;
  const mayCancelAsSeller = mayActAsSeller && SELLER_MAY_CANCEL.includes(order.status);
  const cashOnDelivery = order.paymentProvider === 'CASH_ON_DELIVERY';
  const sellerKeepsMinor = Math.max(0, order.totalMinor - order.platformFeeMinor - order.shippingFeeMinor);

  const pendingOnlinePayment =
    order.status === 'AWAITING_PAYMENT'
      ? order.payments.find((payment) => payment.provider !== 'CASH_ON_DELIVERY' && payment.status !== 'SUCCEEDED') ?? null
      : null;

  const snapshot = asSnapshot(order.address);
  const landmark = text(snapshot, 'nearestLandmark');
  const subcounty = [text(snapshot, 'subcounty'), text(snapshot, 'parish'), text(snapshot, 'village')].filter(Boolean).join(' · ');
  const zoneName = text(snapshot, 'zoneName');
  const capturedDistrict = text(snapshot, 'districtName') ?? order.districtName;

  return (
    <div className="container-page max-w-4xl space-y-5 py-6">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-bemz-700">
        <ArrowLeft className="size-4" aria-hidden />
        Back to my orders
      </Link>

      <header className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Order</p>
            <h1 className="tabular text-2xl font-bold text-ink-950">{order.orderNumber}</h1>
            <p className="mt-1 text-sm text-ink-600">
              Placed {formatDateTime(order.placedAt)} · {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
            </p>
            <p className="mt-0.5 text-sm text-ink-600">
              <Link href={`/shop/${order.shopSlug}`} className="inline-flex items-center gap-1 font-medium text-ink-900 hover:text-bemz-700">
                <Store className="size-3.5" aria-hidden />
                {order.shopName}
              </Link>
              {!isBuyer && (
                <span className="text-ink-500">
                  {' '}
                  · bought by {order.buyerName ?? 'a buyer'} ({displayPhone(order.buyerPhone)})
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <StatusPill status={order.status} />
            <p className="tabular mt-2 text-lg font-bold text-ink-900">{money(order.totalMinor, order.currency)}</p>
            <p className="text-xs text-ink-500">
              {order.amountPaidMinor > 0 ? `${money(order.amountPaidMinor, order.currency)} paid` : 'Nothing paid yet'}
              {order.refundedMinor > 0 ? ` · ${money(order.refundedMinor, order.currency)} refunded` : ''}
            </p>
          </div>
        </div>

        {CLOSED.includes(order.status) ? (
          <p className="rounded-card bg-ink-50 px-4 py-3 text-sm text-ink-700">
            {order.status === 'CANCELLED' && (
              <>
                <span className="font-semibold text-ink-900">Cancelled.</span>{' '}
                {order.cancellationReason ? `Reason given: ${order.cancellationReason}.` : 'No reason was recorded.'}
                {order.refundedMinor > 0
                  ? ` ${money(order.refundedMinor, order.currency)} is on its way back to the number that paid.`
                  : order.amountPaidMinor > 0
                    ? ' A refund has not been raised yet — the shop and Bemz both see this order.'
                    : ' Nothing was taken, so there is nothing to return.'}
              </>
            )}
            {order.status === 'REFUNDED' && (
              <>
                <span className="font-semibold text-ink-900">Refunded.</span>{' '}
                {money(order.refundedMinor, order.currency)} was returned to {paymentLabel(order.paymentProvider ?? '')}.{' '}
                {order.cancellationReason ? `Recorded reason: ${order.cancellationReason}.` : ''}
              </>
            )}
            {order.status === 'FAILED' && (
              <>
                <span className="font-semibold text-ink-900">This order did not go through.</span> Nothing was charged —
                order the items again and the same stock rules apply.
              </>
            )}
          </p>
        ) : (
          <StageRail status={order.status} />
        )}
      </header>

      {order.expiresAt && order.status !== 'DELIVERED' && (
        <p className="rounded-card bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          {order.status === 'AWAITING_PAYMENT'
            ? `This order holds its stock for ${formatCountdown(order.expiresAt)}.`
            : `Confirmation window: ${formatCountdown(order.expiresAt)} before the shop is allowed to release the parcel.`}
        </p>
      )}

      {pendingOnlinePayment && (
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold text-ink-900">Finish the payment</h2>
          <p className="text-sm text-ink-600">
            {money(pendingOnlinePayment.amountMinor, order.currency)} to {paymentLabel(pendingOnlinePayment.provider)}.
            Check your phone for the prompt — nothing is charged twice if you tap it again.
          </p>
          <PaymentStatus
            paymentId={pendingOnlinePayment.id}
            provider={pendingOnlinePayment.provider}
            currency={order.currency}
            amountMinor={pendingOnlinePayment.amountMinor}
            initialStatus={pendingOnlinePayment.status}
          />
        </section>
      )}

      {order.canBuyerConfirm && (
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold text-ink-900">Confirm this order</h2>
          <CashOnDeliveryConfirm orderId={order.id} cashOnDelivery={order.paymentProvider === 'CASH_ON_DELIVERY'} />
        </section>
      )}

      {mayActAsSeller && (
        <section className="card space-y-4 border-bemz-200 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold text-ink-900">Seller actions</h2>
              <p className="mt-1 text-sm text-ink-600">
                This is {order.shopName}&rsquo;s parcel. Moving it forward tells the buyer and the rider at the same time — there is no
                separate app to update.
              </p>
            </div>
            <Link href="/seller/orders" className="text-sm font-medium text-bemz-700 underline-offset-2 hover:underline">
              My order queue
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-card bg-bemz-50 px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-bemz-700">You keep</p>
              <p className="tabular mt-0.5 text-lg font-semibold text-bemz-900">{money(sellerKeepsMinor, order.currency)}</p>
              <p className="mt-0.5 text-xs text-bemz-800">
                {money(order.totalMinor, order.currency)} less {money(order.platformFeeMinor, order.currency)} commission
                {order.shippingFeeMinor > 0 ? ` and the ${money(order.shippingFeeMinor, order.currency)} delivery fee` : ''}. If you carried
                the parcel yourself, the delivery is yours too.
              </p>
            </div>
            <div className="rounded-card bg-ink-50 px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Call the buyer</p>
              <a
                href={`tel:${(order.recipientPhone ?? order.buyerPhone ?? '').replace(/[^+\d]/g, '')}`}
                className="tabular mt-0.5 block text-lg font-semibold text-ink-900 hover:text-bemz-700"
              >
                {displayPhone(order.recipientPhone ?? order.buyerPhone)}
              </a>
              <p className="mt-0.5 text-xs text-ink-500">
                {order.recipientPhone && order.buyerPhone && order.recipientPhone !== order.buyerPhone
                  ? `Paying number ${displayPhone(order.buyerPhone)}`
                  : 'The number that receives the parcel.'}
              </p>
            </div>
            <div className="rounded-card bg-ink-50 px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Payment</p>
              <p className="mt-0.5 text-lg font-semibold text-ink-900">{paymentLabel(order.paymentProvider ?? '')}</p>
              <p className="mt-0.5 text-xs text-ink-500">
                {cashOnDelivery
                  ? `${money(order.totalMinor, order.currency)} is collected at the door — it never passes through us, so it is not in a payout.`
                  : `${money(order.amountPaidMinor, order.currency)} taken${order.refundedMinor > 0 ? `, ${money(order.refundedMinor, order.currency)} refunded` : ''}.`}
              </p>
            </div>
          </div>

          <SellerOrderControls orderId={order.id} status={order.status} trackingNumber={order.trackingNumber} />

          {mayCancelAsSeller && (
            <div className="border-t border-ink-200 pt-3">
              <CancelOrderForm orderId={order.id} canRestock />
            </div>
          )}
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-900">In this parcel</h2>
          {order.canReview && (
            <Link href={`/shop/${order.shopSlug}/reviews`} className="text-xs font-medium text-bemz-700 hover:underline">
              Rate {order.shopName}
            </Link>
          )}
        </div>

        <ul className="divide-y divide-ink-100">
          {order.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <ListingImage
                src={item.imageUrl}
                alt={item.productTitle}
                className="size-16 shrink-0 rounded-lg border border-ink-100"
                sizes="64px"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900">
                  {item.productSlug ? (
                    <Link href={`/product/${order.shopSlug}/${item.productSlug}`} className="hover:text-bemz-700">
                      {item.productTitle}
                    </Link>
                  ) : (
                    item.productTitle
                  )}
                </p>
                <p className="mt-0.5 text-xs text-ink-500">
                  {item.variantName} · SKU {item.sku} · {item.quantity} × {money(item.unitPriceMinor, order.currency)}
                </p>
                {item.discountMinor > 0 && (
                  <p className="mt-0.5 text-xs text-bemz-700">−{money(item.discountMinor, order.currency)} off this line</p>
                )}
                {item.returnedQuantity > 0 && (
                  <p className="mt-0.5 text-xs text-clay-700">
                    {item.returnedQuantity} of {item.quantity} returned
                    {item.deliveredQuantity > 0 ? ` · ${item.deliveredQuantity} counted as delivered` : ''}
                  </p>
                )}
                {order.canReview && item.productSlug && (
                  <Link
                    href={`/product/${order.shopSlug}/${item.productSlug}#reviews`}
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-bemz-700 hover:underline"
                  >
                    <BadgeCheck className="size-3.5" aria-hidden />
                    Rate this item
                  </Link>
                )}
              </div>
              <span className="tabular text-sm font-semibold text-ink-900">{money(item.totalMinor, order.currency)}</span>
            </li>
          ))}
        </ul>

        <div className="space-y-1 border-t border-ink-200 px-4 py-3 text-sm">
          <Row label="Items" value={money(order.subtotalMinor, order.currency)} />
          {order.discountMinor > 0 && <Row label="Shop discount" value={`−${money(order.discountMinor, order.currency)}`} tone="text-bemz-700" />}
          <Row label="Delivery" value={order.shippingFeeMinor === 0 ? 'Free' : money(order.shippingFeeMinor, order.currency)} />
          <Row label="Total" value={money(order.totalMinor, order.currency)} strong />
          {order.taxMinor > 0 && (
            <p className="pt-1 text-xs text-ink-500">
              VAT of {money(order.taxMinor, order.currency)} is inside the totals above, not added at the end.
            </p>
          )}
          {order.buyerNote && (
            <p className="pt-2 text-xs text-ink-600">
              <span className="font-semibold text-ink-800">Your note to the seller:</span> {order.buyerNote}
            </p>
          )}
          {order.sellerNote && (
            <p className="text-xs text-ink-600">
              <span className="font-semibold text-ink-800">Seller note:</span> {order.sellerNote}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <MapPin className="size-4 text-bemz-600" aria-hidden />
            Delivered to
          </h2>
          <p className="text-sm text-ink-800">
            {text(snapshot, 'recipientName') ?? order.recipientName ?? order.buyerName ?? '—'}
            <span className="block text-ink-600">{displayPhone(text(snapshot, 'recipientPhone') ?? order.recipientPhone)}</span>
          </p>
          {text(snapshot, 'label') && <p className="text-xs text-ink-500">{text(snapshot, 'label')}</p>}

          <address className="not-italic text-sm text-ink-700">
            {text(snapshot, 'streetAddress') && <span className="block">{text(snapshot, 'streetAddress')}</span>}
            {(subcounty || capturedDistrict) && (
              <span className="block">
                {subcounty && `${subcounty} · `}
                {capturedDistrict}
              </span>
            )}
            {text(snapshot, 'pinCode') && <span className="block tabular">{text(snapshot, 'pinCode')}</span>}
            {landmark && <span className="block text-ink-600">Near: {landmark}</span>}
          </address>

          {order.deliveryNote && <p className="rounded-card bg-ink-50 px-3 py-2 text-xs text-ink-600">Rider note: {order.deliveryNote}</p>}

          <dl className="space-y-1 text-sm">
            {zoneName && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Delivery zone</dt>
                <dd className="text-ink-800">{zoneName}</dd>
              </div>
            )}
            {order.estimatedDeliveryAt && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Expected by</dt>
                <dd className="text-ink-800">{formatDate(order.estimatedDeliveryAt)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Shipment</dt>
              <dd className="text-ink-800">{humanise(order.shipmentStatus)}</dd>
            </div>
            {order.trackingNumber && (
              <div className="flex justify-between gap-3">
                <dt className="text-ink-500">Tracking</dt>
                <dd className="tabular text-ink-800">
                  {order.trackingNumber}
                  {order.courierName ? ` · ${order.courierName}` : ''}
                </dd>
              </div>
            )}
          </dl>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
            <CreditCard className="size-4 text-bemz-600" aria-hidden />
            Money
          </h2>

          {order.payments.length === 0 ? (
            <p className="text-sm text-ink-500">No payment was ever raised for this order.</p>
          ) : (
            <ul className="space-y-2">
              {order.payments.map((payment) => (
                <li key={payment.id} className="rounded-card border border-ink-200 px-3 py-2">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-medium text-ink-900">{paymentLabel(payment.provider)}</span>
                    <span className="tabular text-ink-900">{money(payment.amountMinor, order.currency)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {humanise(payment.status)}
                    {payment.completedAt ? ` · ${formatDateTime(payment.completedAt)}` : ''}
                    {payment.payerPhone ? ` · ${displayPhone(payment.payerPhone)}` : ''}
                  </p>
                  {payment.externalId && <p className="tabular mt-0.5 text-[11px] text-ink-400">Ref {payment.externalId}</p>}
                </li>
              ))}
            </ul>
          )}

          {order.refunds.length > 0 && (
            <div className="space-y-2 pt-1">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-600">
                <RotateCcw className="size-3.5" aria-hidden />
                Refunds
              </h3>
              <ul className="space-y-2">
                {order.refunds.map((refund) => (
                  <li key={refund.id} className="rounded-card border border-clay-200 bg-clay-50 px-3 py-2">
                    <p className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-ink-900">{humanise(refund.status)}</span>
                      <span className="tabular text-ink-900">{money(refund.amountMinor, order.currency)}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-600">
                      {refund.reason ?? 'No reason recorded'} · {formatDate(refund.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {order.groupId && (
            <p className="pt-1 text-xs text-ink-500">
              <Link href={`/checkout/${order.groupId}`} className="font-medium text-bemz-700 hover:underline">
                Payment receipt for the whole basket
              </Link>{' '}
              — other shops in the same order are separate parcels.
            </p>
          )}
        </section>
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-ink-900">What happened</h2>
        <ol className="space-y-3">
          {order.statusHistory.map((event) => (
            <li key={event.id} className="flex gap-3">
              <span className="mt-1 size-2 shrink-0 rounded-full bg-bemz-500" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm text-ink-900">
                  {event.from ? `${humanise(event.from)} → ${humanise(event.to)}` : humanise(event.to)}
                </p>
                <p className="text-xs text-ink-500">{formatDateTime(event.createdAt)}</p>
                {event.note && <p className="mt-0.5 text-xs text-ink-600">{event.note}</p>}
              </div>
            </li>
          ))}
        </ol>

        {order.canBuyerCancel && (
          <div className="border-t border-ink-200 pt-3">
            <CancelOrderForm orderId={order.id} />
          </div>
        )}
      </section>

      {isBuyer && order.status === 'DELIVERED' && (
        <p className="px-1 text-xs leading-relaxed text-ink-500">
          Received something that is not what you ordered? Rate the item honestly and contact the shop from its page —
          both of you see the same order history, and Bemz can read it too.{' '}
          <Link href="/orders" className="font-medium text-bemz-700 hover:underline">
            All my orders
          </Link>
        </p>
      )}
    </div>
  );
}

function StageRail({ status }: { status: OrderStatus }) {
  const reachedIndex = STAGES.reduce((last, stage, index) => (stage.proves.includes(status) ? index : last), -1);

  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 pt-1 text-xs">
      {STAGES.map((stage, index) => (
        <li key={stage.label} className="flex items-center gap-1">
          <span
            className={
              index < reachedIndex
                ? 'font-medium text-bemz-700'
                : index === reachedIndex
                  ? 'rounded-full bg-bemz-600 px-2.5 py-1 font-semibold text-white'
                  : 'text-ink-400'
            }
          >
            {stage.label}
          </span>
          {index < STAGES.length - 1 && <Truck className={`size-3.5 ${index < reachedIndex ? 'text-bemz-500' : 'text-ink-300'}`} aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function Row({ label, value, strong = false, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className={strong ? 'font-semibold text-ink-900' : 'text-ink-500'}>{label}</span>
      <span className={`tabular ${tone ?? ''} ${strong ? 'font-bold text-ink-900' : 'text-ink-800'}`}>{value}</span>
    </div>
  );
}

/** The snapshot is stored JSON, so every key is read defensively rather than trusted. */
type Snapshot = Record<string, unknown>;

function asSnapshot(value: unknown): Snapshot {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Snapshot) : {};
}

function text(snapshot: Snapshot, key: string): string | null {
  const value = snapshot[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
