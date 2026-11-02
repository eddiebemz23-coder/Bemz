import type { Metadata } from 'next';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { sellerPage } from '@/lib/seller-page';
import { sellerShopOverview } from '@/lib/services/shops';
import { ShopProfileForm } from '@/components/seller/shop-profile-form';
import { KycPanel, PayoutAccountForm } from '@/components/seller/shop-verification';
import { fromBps } from '@/lib/client/format';
import { Badge } from '@/components/ui/badge';

/**
 * `GET /seller/shop`
 *
 * The stall itself: the words and pictures buyers read, the district that decides every delivery
 * quote, the documents that unlock gated categories and the number money lands in. Nothing about
 * selling — orders and listings have their own pages.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'My shop · Bemz seller', robots: { index: false } };

export default async function SellerShopPage() {
  const { shop } = await sellerPage('/seller/shop');
  const overview = await sellerShopOverview(shop.id);
  const detail = overview.shop;

  // Two markets, one column of codes. Anything else would be a data problem, and the form's
  // defaults should not crash on it.
  const countryCode = detail.country.code === 'KE' ? 'KE' : 'UG';

  return (
    <div className="space-y-5">
      <header className="card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-bemz-700">Shop settings</p>
            <h1 className="mt-1 text-2xl font-bold text-ink-950">{detail.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone={detail.status === 'ACTIVE' ? 'success' : detail.status === 'SUSPENDED' || detail.status === 'CLOSED' ? 'danger' : 'warning'}>
                {detail.status === 'ACTIVE' ? 'Open for business' : detail.status.toLowerCase()}
              </Badge>
              {detail.isVerified && <Badge tone="brand">Verified seller</Badge>}
              {detail.vacationMode && <Badge tone="warning">On holiday</Badge>}
            </p>
          </div>
          <Link
            href={`/shop/${detail.slug}`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-bemz-700 hover:underline"
          >
            <ExternalLink className="size-4" />
            bemz/shop/{detail.slug}
          </Link>
        </div>

        <dl className="grid grid-cols-2 gap-3 border-t border-ink-100 pt-4 text-sm sm:grid-cols-4">
          {[
            { term: 'Market', value: detail.country.name },
            { term: 'Dispatch base', value: detail.basedIn?.name ?? 'Not set' },
            { term: 'Commission', value: fromBps(detail.commissionRateBps ?? 0) },
            { term: 'Dispatch promise', value: `${detail.dispatchSlaHours} hours` },
          ].map((cell) => (
            <div key={cell.term}>
              <dt className="text-xs text-ink-500">{cell.term}</dt>
              <dd className="mt-0.5 truncate font-semibold text-ink-900">{cell.value}</dd>
            </div>
          ))}
        </dl>

        <p className="text-xs text-ink-500">
          Commission is taken per delivered order from the category of the item — {fromBps(detail.commissionRateBps ?? 0)} is your shop
          default where a category has not said otherwise. Delivery fees a buyer pays to a rider are not your income.
        </p>
      </header>

      <ShopProfileForm
        countryCode={countryCode}
        initial={{
          shopId: detail.id,
          name: detail.name,
          slug: detail.slug,
          tagline: detail.tagline,
          description: detail.description,
          phone: detail.phone,
          whatsappNumber: detail.whatsappNumber,
          email: detail.email,
          streetAddress: detail.streetAddress,
          defaultFulfilment: detail.defaultFulfilment,
          dispatchSlaHours: detail.dispatchSlaHours,
          baseDistrictId: detail.basedIn?.id ?? null,
          logoUrl: detail.logoUrl,
          bannerUrl: detail.bannerUrl,
          vacationMode: detail.vacationMode,
          statusCode: detail.status,
        }}
      />

      <KycPanel shopId={detail.id} countryCode={countryCode} initial={detail.kyc} />

      <PayoutAccountForm
        countryCode={countryCode}
        initial={{
          provider: detail.payoutAccount?.provider ?? null,
          accountNumber: detail.payoutAccount?.accountNumber ?? null,
          accountName: detail.payoutAccount?.accountName ?? null,
          isVerified: detail.payoutAccount?.isVerified ?? false,
        }}
      />

      <p className="text-xs text-ink-500">
        Suspended or closed stalls keep their order queue and their payout page — a seller still has to answer disputes
        and still has to be paid for what they delivered.
      </p>
    </div>
  );
}
