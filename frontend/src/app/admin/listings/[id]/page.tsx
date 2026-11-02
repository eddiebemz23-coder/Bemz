import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { adminPage } from '@/lib/admin-page';
import { getProductById } from '@/lib/services/products';
import { pageData } from '@/lib/page-data';
import { fromBps, formatDateTime, humanise, money } from '@/lib/client/format';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ListingImage } from '@/components/ui/listing-image';
import { StatusPill } from '@/components/ui/status-pill';
import { AdminDecisionForm } from '@/components/admin/decision-form';

/**
 * `GET /admin/listings/[id]`
 *
 * The reviewer&rsquo;s reading copy of a listing: everything the seller wrote, every option with
 * its cost price, the stock behind it and the questions buyers have already asked. The public page
 * hides cost prices and refuses to show a listing that is not live, so moderation needs its own
 * render of the same row — otherwise a decision is made on a photo and a title.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Listing review', robots: { index: false } };

interface Props {
  params: { id: string };
}

const SHOP_STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'danger',
  CLOSED: 'neutral',
};

export default async function AdminListingPage({ params }: Props) {
  await adminPage(`/admin/listings/${params.id}`);

  const product = await pageData(getProductById(params.id));
  if (product.deletedAt) notFound();

  const primary = product.categories.find((link) => link.isPrimary) ?? product.categories[0] ?? null;
  const livePrice = product.startingPriceMinor ?? product.variants[0]?.priceMinor ?? null;

  return (
    <div className="space-y-5">
      <Link href="/admin/queues?tab=listings" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-bemz-700">
        <ArrowLeft className="size-4" aria-hidden />
        Back to the queue
      </Link>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink-900">{product.title}</h1>
            {product.subtitle && <p className="mt-0.5 text-sm text-ink-600">{product.subtitle}</p>}
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <StatusPill status={product.status} />
              {product.isDigital && <Badge tone="info">Digital — no parcel</Badge>}
              {product.requiresModeration && <Badge tone="warning">Re-checks on every edit</Badge>}
              {product.condition === 'USED' && <Badge tone="neutral">Used</Badge>}
              {product.sku && <span className="tabular">Master SKU {product.sku}</span>}
            </p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <Link href={`/admin/shops/${product.shop.id}`} className="font-medium text-ink-900 hover:text-bemz-700">
                {product.shop.name}
              </Link>
              <Badge tone={SHOP_STATUS_TONE[product.shop.status] ?? 'neutral'}>{humanise(product.shop.status)}</Badge>
              {product.shop.isVerified && <Badge tone="success">Verified</Badge>}
              <span className="text-xs text-ink-500">
                {product.shop.totalSalesCount} payouts settled · rating{' '}
                <span className="tabular">{product.shop.ratingAvg === null ? 'new' : Number(product.shop.ratingAvg).toFixed(1)}</span>
              </span>
            </p>
          </div>
          <div className="text-right">
            {livePrice !== null && <p className="tabular text-2xl font-bold text-ink-950">{money(livePrice, product.currency)}</p>}
            {product.discountPct ? <p className="text-xs text-clay-700">{product.discountPct}% off shown to buyers</p> : null}
            <p className="mt-1 text-xs text-ink-500">submitted {formatDateTime(product.createdAt)}</p>
            {product.moderatedAt && <p className="text-xs text-ink-500">last decision {formatDateTime(product.moderatedAt)}</p>}
          </div>
        </div>

        {product.rejectionReason && (
          <p className="mt-4 rounded-card border border-clay-200 bg-clay-50 px-3 py-2 text-sm text-clay-800">
            <span className="font-semibold">Why it was refused last time:</span> {product.rejectionReason}
          </p>
        )}

        {product.status === 'ACTIVE' && (
          <Link
            href={`/product/${product.shop.slug}/${product.slug}`}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-bemz-700 hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            See it as a buyer
          </Link>
        )}
      </section>

      <section className="card p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Views', value: product.viewsCount.toLocaleString() },
            { label: 'Units sold', value: product.soldCount.toLocaleString() },
            { label: 'Saved by buyers', value: product.wishlistsCount.toLocaleString() },
            {
              label: 'Rating',
              value: product.ratingCount === 0 ? 'no ratings' : `${Number(product.ratingAvg ?? 0).toFixed(1)} from ${product.ratingCount}`,
            },
          ].map((stat) => (
            <div key={stat.label} className="rounded-card bg-ink-50 px-3 py-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{stat.label}</p>
              <p className="tabular mt-0.5 text-lg font-semibold text-ink-900">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-ink-600">
          {product.categories.map((link) => (
            <span key={link.categoryId} className="flex items-center gap-1.5 rounded-full bg-ink-50 px-2.5 py-1">
              {link.category.name}
              {link.isPrimary && <span className="font-semibold text-ink-800">main</span>}
              <span className="tabular">{fromBps(link.category.commissionRateBps)}</span>
              {link.category.requiresKyc && <Badge tone="warning">needs approved ID</Badge>}
            </span>
          ))}
        </div>
        {primary && livePrice !== null && (
          <p className="mt-2 text-xs text-ink-500">
            At {fromBps(primary.category.commissionRateBps)} the platform holds{' '}
            {money(Math.round((livePrice * primary.category.commissionRateBps) / 10_000), product.currency)} of this price. The shop&rsquo;s
            own rate wins if it differs.
          </p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Photos the buyer sees</h2>
        {product.images.length === 0 ? (
          <p className="mt-3 text-sm text-clay-800">This listing has no photo. A buyer scrolls past an item they cannot see.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {product.images.map((image) => (
              <li key={image.id} className="space-y-1">
                <ListingImage src={image.url} alt={image.altText ?? product.title} className="aspect-square rounded-lg border border-ink-100" sizes="200px" />
                <p className="flex items-center justify-between gap-1 text-[11px] text-ink-500">
                  <span className="truncate">{image.altText ?? 'no caption'}</span>
                  {image.isPrimary && <span className="font-semibold text-bemz-700">cover</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Options, prices and stock</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-500">
                <th className="px-5 py-2 font-medium">Option</th>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Was</th>
                <th className="px-3 py-2 text-right font-medium">Cost (private)</th>
                <th className="px-3 py-2 text-right font-medium">On shelf</th>
                <th className="px-3 py-2 text-right font-medium">In carts</th>
                <th className="px-5 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {product.variants.map((variant) => (
                <tr key={variant.id} className={variant.isDisabled ? 'text-ink-400' : undefined}>
                  <td className="px-5 py-2.5">
                    <span className="font-medium text-ink-900">{variant.name}</span>
                    {variant.isPrimary && <span className="ml-2 text-xs text-bemz-700">shown first</span>}
                    {Object.entries((variant.attributes ?? {}) as Record<string, string>).length > 0 && (
                      <span className="block text-xs text-ink-500">
                        {Object.entries((variant.attributes ?? {}) as Record<string, string>)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2.5 text-xs text-ink-600">{variant.sku}</td>
                  <td className="tabular px-3 py-2.5 text-right">{money(variant.priceMinor, variant.currency)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-500">
                    {variant.compareAtPriceMinor ? money(variant.compareAtPriceMinor, variant.currency) : '—'}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-ink-500">
                    {variant.costPriceMinor ? money(variant.costPriceMinor, variant.currency) : '—'}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{variant.stockQuantity}</td>
                  <td className="tabular px-3 py-2.5 text-right">{variant.reservedQuantity}</td>
                  <td className="px-5 py-2.5 text-xs">
                    {variant.isDisabled
                      ? 'Disabled by the seller'
                      : [variant.maxQuantityPerOrder ? `max ${variant.maxQuantityPerOrder} per order` : null, variant.weightGrams ? `${variant.weightGrams}g` : null, 'live']
                          .filter(Boolean)
                          .join(' · ')}
                  </td>
                </tr>
              ))}
              {product.variants.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-4 text-sm text-clay-800">
                    No purchasable option on this listing — it cannot be bought as it stands.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {product.weightGrams && <p className="px-5 py-3 text-xs text-ink-500">Listing weight {product.weightGrams}g · {product.fulfilmentType.replace(/_/g, ' ').toLowerCase()}</p>}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Description</h2>
          <p className="whitespace-pre-line text-sm text-ink-800">{product.description}</p>
          {product.attributes.length > 0 && (
            <dl className="grid gap-x-4 gap-y-1 border-t border-ink-100 pt-3 text-sm sm:grid-cols-2">
              {product.attributes.map((attribute) => (
                <div key={attribute.id} className="flex justify-between gap-3">
                  <dt className="text-ink-500">{attribute.name}</dt>
                  <dd className="text-ink-900">{attribute.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {(product.brand || product.warrantyText) && (
            <p className="border-t border-ink-100 pt-3 text-xs text-ink-600">
              {product.brand ? `Brand ${product.brand}` : 'No brand given'}
              {product.warrantyText ? ` · ${product.warrantyText}` : ' · no warranty stated'}
            </p>
          )}
          {(product.metaTitle || product.metaDescription) && (
            <p className="text-xs text-ink-500">
              Search snippet: {product.metaTitle ?? product.title} — {product.metaDescription ?? 'no description written'}
            </p>
          )}
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Questions buyers asked</h2>
          {product.questions.length === 0 ? (
            <p className="text-sm text-ink-500">Nobody has asked anything about this item yet.</p>
          ) : (
            <ul className="space-y-3">
              {product.questions.map((question) => (
                <li key={question.id} className="rounded-card bg-ink-50 px-3 py-2.5">
                  <p className="text-sm text-ink-900">{question.body}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {question.user.name ?? 'A buyer'} · {formatDateTime(question.createdAt)}
                  </p>
                  {question.answers.length === 0 ? (
                    <p className="mt-1 text-xs text-clay-700">Still unanswered</p>
                  ) : (
                    question.answers.map((answer) => (
                      <p key={answer.id} className="mt-1 border-l-2 border-bemz-300 pl-2 text-xs text-ink-700">
                        <span className="font-medium text-ink-900">{answer.responder.name ?? 'Someone'}:</span> {answer.body}
                      </p>
                    ))
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Decision</h2>
        <p className="text-sm text-ink-600">
          {product.status === 'PENDING_REVIEW'
            ? 'This listing is waiting for a first look.'
            : product.status === 'REJECTED'
              ? 'It was refused. Approving it now puts it in front of buyers without another edit.'
              : product.status === 'DRAFT'
                ? 'The seller has not submitted it yet; approving a draft publishes it.'
                : `It is ${humanise(product.status).toLowerCase()}. Re-checks land here when the seller edits something that needs a second look.`}
        </p>
        <AdminDecisionForm
          endpoint={`/api/admin/products/${product.id}/moderate`}
          field="decision"
          subject={product.title}
          choices={[
            { value: 'APPROVE', label: 'Approve and publish', variant: 'primary', hint: 'The seller is told it is live.' },
            {
              value: 'REJECT',
              label: 'Reject',
              needsReason: true,
              variant: 'danger',
              hint: 'Write what to fix — the seller sees this and the listing stays editable.',
            },
          ]}
        />
        <p className="text-xs text-ink-500">
          Archiving or deleting a listing is the seller&rsquo;s own action, not the platform&rsquo;s — this screen can refuse a listing, it
          cannot destroy work.
        </p>
      </section>
    </div>
  );
}
