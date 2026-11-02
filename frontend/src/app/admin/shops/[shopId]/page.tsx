import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { adminPage } from '@/lib/admin-page';
import { kycCase } from '@/lib/services/shops';
import { pageData } from '@/lib/page-data';
import { displayPhone, formatDate, formatDateTime, humanise } from '@/lib/client/format';
import { REGIONS, regionForCurrency } from '@/lib/client/regions';
import type { CurrencyCode } from '@/lib/prisma';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { AdminDecisionForm, VerifiedToggle } from '@/components/admin/decision-form';
import { KycDecisionForm } from '@/components/admin/kyc-decision';

/**
 * `GET /admin/shops/[shopId]`
 *
 * The identity file behind a stall: what the seller claims, the documents they uploaded, who
 * decided on them and when. This is the only screen in the product that shows an ID number — a
 * reviewer cannot verify a paper without reading the digits off it, which is why the route that
 * signs the document URLs is admin-only and the links it hands out expire.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Seller verification case', robots: { index: false } };

interface Props {
  params: { shopId: string };
}

const KYC_TONE: Record<string, BadgeTone> = {
  NOT_SUBMITTED: 'neutral',
  SUBMITTED: 'info',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
};

const DOCUMENT_TONE: Record<string, BadgeTone> = {
  SUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'danger',
  EXPIRED: 'warning',
};

export default async function AdminShopCasePage({ params }: Props) {
  await adminPage(`/admin/shops/${params.shopId}`);

  const detail = await pageData(kycCase(params.shopId));
  const { shop, documents } = detail;
  const dialCode = REGIONS[regionForCurrency((shop.country.code === 'KE' ? 'KES' : 'UGX') as CurrencyCode)].dialCode;

  return (
    <div className="space-y-5">
      <Link href="/admin/queues?tab=kyc" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-bemz-700">
        <ArrowLeft className="size-4" aria-hidden />
        Back to the queues
      </Link>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink-900">{shop.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <StatusPill status={shop.status} />
              <Badge tone={KYC_TONE[shop.kycStatus] ?? 'neutral'}>{humanise(shop.kycStatus)}</Badge>
              <span>
                opened {formatDate(shop.createdAt)} · {shop._count.products} listing{shop._count.products === 1 ? '' : 's'}
              </span>
            </p>
            <p className="mt-2 text-sm text-ink-600">
              <Link href={`/shop/${shop.slug}`} className="font-medium text-bemz-700 hover:underline">
                /shop/{shop.slug}
              </Link>{' '}
              · {shop.country.name} ({shop.country.code})
              {shop.baseDistrict ? ` · dispatches from ${shop.baseDistrict.name} (${shop.baseDistrict.code})` : ' · no dispatch district set'}
            </p>
          </div>
          <div className="text-right text-xs text-ink-500">
            <p>Shop phone <span className="tabular text-ink-800">{displayPhone(shop.phone, dialCode)}</span></p>
            {shop.email && <p className="mt-0.5">{shop.email}</p>}
            {shop.kycApprovedAt && <p className="mt-0.5 text-bemz-700">ID approved {formatDateTime(shop.kycApprovedAt)}</p>}
          </div>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-ink-100 pt-4 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Claimed national ID / NIN</dt>
            <dd className="tabular text-ink-900">{shop.nationalIdNumber ?? 'not captured'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Tax PIN</dt>
            <dd className="tabular text-ink-900">{shop.taxPin ?? 'not captured'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Business name</dt>
            <dd className="text-ink-900">{shop.kycBusinessName ?? 'trading as the shop name'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Account holder</dt>
            <dd className="min-w-0 truncate text-ink-900">
              <Link href={`/admin/users/${shop.owner.id}`} className="font-medium hover:text-bemz-700">
                {shop.owner.name ?? 'unnamed'}
              </Link>
              <span className="tabular"> · {displayPhone(shop.owner.phone, dialCode)}</span>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-ink-500">
          The numbers above are what the documents have to match. A payout cannot be approved while this shop&rsquo;s ID is anything other
          than approved, so this file is also the reason a seller cannot take their money.
        </p>
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Documents on file</h2>
        </div>
        {documents.length === 0 ? (
          <EmptyState
            title="Nothing uploaded"
            description="The seller has submitted no ID documents. The stall stays closed until a national ID arrives."
            action={
              <Link href={`/admin/users/${shop.owner.id}`} className="text-sm font-medium text-bemz-700 hover:underline">
                Open the account file
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {documents.map((document) => (
              <li key={document.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink-900">{humanise(document.type)}</span>
                    <Badge tone={DOCUMENT_TONE[document.status] ?? 'neutral'}>{humanise(document.status)}</Badge>
                    <span className="text-xs text-ink-500">submitted {formatDateTime(document.submittedAt)}</span>
                    {document.expiresAt && <span className="text-xs text-ink-500">expires {formatDate(document.expiresAt)}</span>}
                  </p>
                  {document.reviewNote && (
                    <p className="text-xs text-ink-700">
                      <span className="font-medium">Note:</span> {document.reviewNote}
                      {document.reviewedBy ? ` — ${document.reviewedBy.name}` : ''}
                      {document.reviewedAt ? ` · ${formatDateTime(document.reviewedAt)}` : ''}
                    </p>
                  )}
                </div>
                <a
                  href={document.viewUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-disabled={!document.viewUrl}
                  className={
                    document.viewUrl
                      ? 'inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm font-medium text-ink-800 hover:border-bemz-400'
                      : 'inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-400'
                  }
                >
                  <ShieldCheck className="size-4" aria-hidden />
                  {document.viewUrl ? 'View the document' : 'Storage is not configured'}
                </a>
              </li>
            ))}
          </ul>
        )}
        {documents.length > 0 && (
          <div className="border-t border-ink-100 px-5 py-4">
            <KycDecisionForm shopId={shop.id} shopName={shop.name} documents={documents} />
          </div>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Shop status</h2>
        <p className="text-sm text-ink-600">
          {shop.kycStatus === 'APPROVED'
            ? 'The ID is approved, so this stall can be opened.'
            : 'Approving the documents above is what opens a stall — status cannot be set to active before that.'}
        </p>
        <AdminDecisionForm
          endpoint={`/api/admin/shops/${shop.id}`}
          method="PATCH"
          field="status"
          subject={shop.name}
          choices={[
            { value: 'ACTIVE', label: 'Open the stall', variant: 'primary', hint: 'Live in search and to buyers again.' },
            { value: 'SUSPENDED', label: 'Suspend', needsReason: true, variant: 'secondary', hint: 'Hidden from discovery. Existing orders stay readable so nobody loses a parcel.' },
            { value: 'CLOSED', label: 'Close for good', needsReason: true, variant: 'danger', hint: 'Refused while nothing is still in delivery — the server stops it if a rider is mid-route.' },
          ]}
        />
        <VerifiedToggle shopId={shop.id} shopName={shop.name} verified={shop.isVerified} />
        <p className="text-xs leading-relaxed text-ink-500">
          Suspension is the tool for a shop that is breaking rules while it still has parcels to finish. Closing is final: it is refused
          while any order is in flight, because a closed shop with a live parcel leaves the buyer holding a receipt and no seller.
        </p>
      </section>
    </div>
  );
}
