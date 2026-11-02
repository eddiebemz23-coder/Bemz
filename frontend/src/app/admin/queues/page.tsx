import type { Metadata } from 'next';
import Link from 'next/link';
import { adminPage } from '@/lib/admin-page';
import { moderationQueues } from '@/lib/services/moderation';
import { reviewModerationQueue } from '@/lib/services/reviews';
import { parseParams, hrefWith } from '@/lib/catalog-params';
import { reviewQueueQuerySchema } from '@/lib/validation/catalog';
import { formatRelative, humanise, money } from '@/lib/client/format';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ListingImage } from '@/components/ui/listing-image';
import { Pagination } from '@/components/ui/pagination';
import { Stars } from '@/components/ui/stars';
import { StatusPill } from '@/components/ui/status-pill';
import { AdminDecisionForm } from '@/components/admin/decision-form';
import { KycDecisionForm } from '@/components/admin/kyc-decision';

/**
 * `GET /admin/queues`
 *
 * The four piles a marketplace has to work through before lunch: a listing nobody has looked at,
 * a stall that cannot open until a person says yes, the ID documents behind that yes, and reviews
 * somebody reported. Tabs are links rather than client state so a queue can be sent around the
 * team as a URL and so the page works on a connection that never finishes hydrating.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Moderation queues', robots: { index: false } };

const TABS = ['listings', 'shops', 'kyc', 'reviews'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = { listings: 'Listings', shops: 'Stalls', kyc: 'ID documents', reviews: 'Reviews' };

const REVIEW_STATUSES = ['PENDING', 'PUBLISHED', 'REMOVED'] as const;

const KYC_TONE: Record<string, BadgeTone> = {
  NOT_SUBMITTED: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

function TabChip({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={
        active
          ? 'flex items-center gap-1.5 rounded-lg bg-bemz-600 px-3 py-1.5 text-sm font-semibold text-white'
          : 'flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-bemz-400'
      }
    >
      {label}
      <span className="tabular rounded-full bg-white/25 px-1.5 text-xs">{count}</span>
    </Link>
  );
}

export default async function AdminQueuesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await adminPage('/admin/queues');

  const requestedTab = TABS.includes(searchParams.tab as Tab) ? (searchParams.tab as Tab) : 'listings';
  const reviewParams = parseParams(reviewQueueQuerySchema, searchParams);

  const queues = await moderationQueues();
  const reviews = requestedTab === 'reviews' ? await reviewModerationQueue(reviewParams) : null;
  // The queue is filtered by one status, so the pill says what this pile is rather than pretending
  // each row carries its own.
  const activeReviewStatus = reviewParams.status ?? 'PENDING';

  const kycByShop = new Map<string, { shopId: string; name: string; slug: string; nationalIdNumber: string | null; taxPin: string | null; documents: { id: string; type: string; status: string }[] }>();
  for (const document of queues.kycDocuments) {
    const group = kycByShop.get(document.shopId) ?? {
      shopId: document.shopId,
      name: document.shop.name,
      slug: document.shop.slug,
      nationalIdNumber: document.shop.nationalIdNumber,
      taxPin: document.shop.taxPin,
      documents: [],
    };
    group.documents.push({ id: document.id, type: document.type, status: document.status });
    kycByShop.set(document.shopId, group);
  }

  const counts: Record<Tab, number> = {
    listings: queues.products.length,
    shops: queues.shops.length,
    kyc: kycByShop.size,
    reviews: queues.pendingReviewCount,
  };

  const tabHref = (tab: Tab) => hrefWith('/admin/queues', { tab }, { tab });

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h1 className="text-xl font-semibold text-ink-900">Queues</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-600">
          Each decision here is filed with your name and a reason, and the person affected is told. A listing that is refused stays
          editable, an account that is banned keeps its orders, and a review that is hidden keeps its text — nothing on these four tabs is
          ever deleted.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Queue">
          {TABS.map((tab) => (
            <TabChip key={tab} href={tabHref(tab)} active={tab === requestedTab} label={TAB_LABEL[tab]} count={counts[tab]} />
          ))}
        </div>
      </section>

      {requestedTab === 'listings' && (
        <section className="card overflow-hidden">
          <div className="border-b border-ink-100 px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Listings waiting for a first look</h2>
          </div>
          {queues.products.length === 0 ? (
            <EmptyState title="Nothing is stuck" description="No listing is waiting for moderation right now." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {queues.products.map((product) => (
                <li key={product.id} className="flex flex-wrap gap-4 px-5 py-4">
                  <ListingImage src={product.imageUrl} alt={product.title} className="size-20 shrink-0 rounded-lg" sizes="80px" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <Link href={`/admin/listings/${product.id}`} className="text-sm font-semibold text-ink-900 hover:text-bemz-700">
                      {product.title}
                    </Link>
                    <p className="tabular text-sm text-ink-800">{money(product.startingPriceMinor, product.currency)}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <Link href={`/shop/${product.shop.slug}`} className="font-medium text-ink-700 hover:text-bemz-700">
                        {product.shop.name}
                      </Link>
                      <Badge tone={KYC_TONE[product.shop.kycStatus] ?? 'neutral'}>{humanise(product.shop.kycStatus)}</Badge>
                      {/* `totalSalesCount` is raised when finance books a payout as sent, so on a
                          moderation screen it means "already paid out this many times", not "sold
                          this many items". */}
                      <span>{product.shop.totalSalesCount} payouts settled</span>
                      <span>· waiting since {formatRelative(product.createdAt)}</span>
                    </p>
                    {product.primaryCategory && (
                      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
                        <span className="font-medium">Category:</span>
                        {product.primaryCategory.name}
                        {product.primaryCategory.requiresKyc && (
                          <Badge tone="warning">This category needs approved ID</Badge>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="w-full sm:w-auto sm:min-w-[15rem]">
                    <AdminDecisionForm
                      endpoint={`/api/admin/products/${product.id}/moderate`}
                      field="decision"
                      subject={product.title}
                      choices={[
                        { value: 'APPROVE', label: 'Approve', variant: 'primary', hint: 'Puts the listing in front of buyers.' },
                        {
                          value: 'REJECT',
                          label: 'Reject',
                          needsReason: true,
                          variant: 'danger',
                          hint: 'The seller keeps the listing and sees your note. Say what to fix.',
                        },
                      ]}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {requestedTab === 'shops' && (
        <section className="card overflow-hidden">
          <div className="border-b border-ink-100 px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Stalls that have not been opened yet</h2>
          </div>
          {queues.shops.length === 0 ? (
            <EmptyState title="No stall is waiting" description="Every shop that applied has been decided." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {queues.shops.map((shop) => (
                <li key={shop.id} className="flex flex-wrap gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Link href={`/admin/shops/${shop.id}`} className="text-sm font-semibold text-ink-900 hover:text-bemz-700">
                      {shop.name}
                    </Link>
                    <p className="text-xs text-ink-500">
                      <Link href={`/shop/${shop.slug}`} className="font-medium text-ink-700 hover:text-bemz-700">
                        /shop/{shop.slug}
                      </Link>{' '}
                      · {shop.country.name} ({shop.country.code})
                      {shop.baseDistrict ? ` · dispatches from ${shop.baseDistrict.name}` : ''}
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-600">
                      <Badge tone={KYC_TONE[shop.kycStatus] ?? 'neutral'}>{humanise(shop.kycStatus)}</Badge>
                      <span>{shop._count.products} listing{shop._count.products === 1 ? '' : 's'}</span>
                      <span>· applied {formatRelative(shop.createdAt)}</span>
                    </p>
                    <p className="text-xs text-ink-600">
                      Owner:{' '}
                      <Link href={`/admin/users/${shop.owner.id}`} className="font-medium text-ink-900 hover:text-bemz-700">
                        {shop.owner.name ?? 'unnamed'}
                      </Link>{' '}
                      <span className="tabular">{shop.owner.phone}</span>
                      <Badge tone={shop.owner.phoneVerified ? 'success' : 'warning'}>
                        {shop.owner.phoneVerified ? 'Phone verified' : 'Phone not verified'}
                      </Badge>
                    </p>
                  </div>
                  <div className="w-full space-y-3 sm:w-auto sm:min-w-[16rem]">
                    <p className="text-xs text-ink-500">
                      A stall opens by itself when every ID document is approved. This form is for holding a shop back or refusing it.
                    </p>
                    <AdminDecisionForm
                      endpoint={`/api/admin/shops/${shop.id}`}
                      method="PATCH"
                      field="status"
                      subject={shop.name}
                      choices={[
                        { value: 'SUSPENDED', label: 'Put on hold', needsReason: true, variant: 'secondary', hint: 'Hidden from buyers, every order stays readable.' },
                        { value: 'CLOSED', label: 'Refuse this stall', needsReason: true, variant: 'danger', hint: 'The seller is told why and cannot take orders.' },
                      ]}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {requestedTab === 'kyc' && (
        <section className="card overflow-hidden">
          <div className="border-b border-ink-100 px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">ID documents to check</h2>
          </div>
          {kycByShop.size === 0 ? (
            <EmptyState title="No documents submitted" description="Nothing is waiting for an identity check." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {[...kycByShop.values()].map((group) => (
                <li key={group.shopId} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-2">
                    <Link href={`/admin/shops/${group.shopId}`} className="text-sm font-semibold text-ink-900 hover:text-bemz-700">
                      {group.name}
                    </Link>
                    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                      <div className="flex justify-between gap-2 sm:block">
                        <dt className="text-ink-500">National ID / NIN</dt>
                        <dd className="tabular text-ink-800">{group.nationalIdNumber ?? 'not captured'}</dd>
                      </div>
                      <div className="flex justify-between gap-2 sm:block">
                        <dt className="text-ink-500">Tax PIN</dt>
                        <dd className="tabular text-ink-800">{group.taxPin ?? 'not captured'}</dd>
                      </div>
                    </dl>
                    <p className="text-xs text-ink-500">
                      The numbers above are what the documents have to match. Open the case to see the photos — they are only ever shown to
                      an admin, on a signed link that expires.
                    </p>
                  </div>
                  <KycDecisionForm shopId={group.shopId} shopName={group.name} documents={group.documents} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {requestedTab === 'reviews' && reviews && (
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Reviews</h2>
            <div className="flex flex-wrap gap-1.5">
              {REVIEW_STATUSES.map((status) => (
                <Link
                  key={status}
                  href={hrefWith('/admin/queues', { tab: 'reviews', status }, { tab: 'reviews', status })}
                  className={
                    (reviewParams.status ?? 'PENDING') === status
                      ? 'rounded-lg bg-ink-900 px-2.5 py-1 text-xs font-semibold text-white'
                      : 'rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:border-ink-400'
                  }
                >
                  {humanise(status)}
                </Link>
              ))}
            </div>
          </div>

          {reviews.items.length === 0 ? (
            <EmptyState
              title="Nothing in this pile"
              description="Reviews are published as they arrive — this queue holds reports and the small share kept for a first look."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {reviews.items.map((review) => (
                <li key={review.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="space-y-1.5">
                    <p className="flex flex-wrap items-center gap-2">
                      <Stars value={review.rating} size="sm" />
                      <StatusPill status={activeReviewStatus} />
                      <span className="text-xs text-ink-500">
                        {review.author.displayName} · {formatRelative(review.createdAt)}
                      </span>
                      {review.isVerifiedPurchase && <Badge tone="success">Verified purchase</Badge>}
                    </p>
                    {review.title && <p className="text-sm font-medium text-ink-900">{review.title}</p>}
                    <p className="text-sm text-ink-700">{review.body}</p>
                    <p className="text-xs text-ink-500">
                      {review.targetType === 'PRODUCT' && review.product ? (
                        <Link href={`/admin/listings/${review.product.id}`} className="font-medium text-ink-700 hover:text-bemz-700">
                          {review.product.title}
                        </Link>
                      ) : review.shop ? (
                        <Link href={`/admin/shops/${review.shop.id}`} className="font-medium text-ink-700 hover:text-bemz-700">
                          {review.shop.name}
                        </Link>
                      ) : (
                        'No target on this review'
                      )}
                      <span> · {review.helpfulCount} found it helpful</span>
                    </p>
                  </div>
                  <AdminDecisionForm
                    endpoint={`/api/admin/reviews/${review.id}/moderate`}
                    field="decision"
                    subject="the review"
                    choices={[
                      { value: 'PUBLISH', label: 'Publish', variant: 'primary', hint: 'Live on the listing and counted in the average.' },
                      {
                        value: 'REMOVE',
                        label: 'Remove',
                        needsReason: true,
                        variant: 'danger',
                        hint: 'The buyer is told why. The text stays for the appeal.',
                      },
                      { value: 'HOLD', label: 'Hold', needsReason: true, variant: 'secondary', hint: 'Back in the pending pile with your note.' },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}

          <Pagination
            page={reviews.page}
            perPage={reviews.perPage}
            total={reviews.total}
            hrefFor={(page) =>
              hrefWith('/admin/queues', { tab: 'reviews', status: reviewParams.status ?? 'PENDING', page, perPage: reviewParams.perPage }, { page })
            }
            className="border-t border-ink-100"
          />
        </section>
      )}
    </div>
  );
}
