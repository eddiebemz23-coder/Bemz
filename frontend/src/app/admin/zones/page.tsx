import type { Metadata } from 'next';
import Link from 'next/link';
import { adminPage } from '@/lib/admin-page';
import { listCountries, listDistricts, listZones } from '@/lib/services/geo';
import { parseParams, hrefWith } from '@/lib/catalog-params';
import { districtQuerySchema } from '@/lib/validation/commerce';
import { etaLabel, money } from '@/lib/client/format';
import type { CurrencyCode } from '@/lib/money';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DistrictZoneForm, ZoneEditor, type ZoneSnapshot } from '@/components/admin/zone-editor';

/**
 * `GET /admin/zones`
 *
 * Delivery is the part of this business a competitor cannot copy with a landing page. A zone is a
 * price and a promise, and every town has exactly one of each, so this screen is where a fee change
 * or a new town becomes real. Edits are per field and diffed before sending: the audit trail has to
 * read "Kampala base fee 5,000 → 8,000", not "somebody saved the form".
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Delivery zones', robots: { index: false } };

const COUNTRY_TONE: Record<string, BadgeTone> = { UG: 'info', KE: 'success' };

export default async function AdminZonesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await adminPage('/admin/zones');

  const { country } = parseParams(districtQuerySchema, searchParams);
  const countryCode = country as 'UG' | 'KE' | undefined;

  const [zones, countries, districts] = await Promise.all([
    listZones(countryCode),
    listCountries(),
    listDistricts(countryCode ? { country: countryCode } : {}),
  ]);

  const snapshots: ZoneSnapshot[] = zones.map((zone) => ({
    id: zone.id,
    code: zone.code,
    name: zone.name,
    country: zone.country,
    currency: zone.currency as CurrencyCode,
    baseFeeMinor: zone.baseFeeMinor,
    perKgFeeMinor: zone.perKgFeeMinor,
    freeOverMinor: zone.freeOverMinor,
    estimatedDaysMin: zone.estimatedDays.min,
    estimatedDaysMax: zone.estimatedDays.max,
    cashOnDeliveryAllowed: zone.cashOnDeliveryAllowed,
    isActive: zone.isActive,
    districtCount: zone.districtCount,
  }));

  const unreachable = districts.unreachable.map((district) => ({
    id: district.id,
    name: district.name,
    code: district.code,
    country: district.country,
  }));

  // The assignment picker needs every zone in the district's country, including ones the country
  // filter is not currently showing, so it reads the unfiltered list.
  const allZones = countryCode ? await listZones() : zones;
  const zoneOptions = allZones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    code: zone.code,
    country: zone.country,
    currency: zone.currency as CurrencyCode,
    baseFeeMinor: zone.baseFeeMinor,
  }));

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h1 className="text-xl font-semibold text-ink-900">Delivery</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-600">
          A zone prices every town inside it and sets the transit promise those towns see at checkout.
          Change a fee and only new quotes move — an order already placed keeps the number the buyer was
          shown.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={hrefWith('/admin/zones', {}, { country: undefined })}
            aria-current={!countryCode ? 'page' : undefined}
            className={
              !countryCode
                ? 'rounded-lg bg-bemz-600 px-3 py-1.5 text-sm font-semibold text-white'
                : 'rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-bemz-400'
            }
          >
            Both countries
          </Link>
          {countries.map((row) => (
            <Link
              key={row.code}
              href={hrefWith('/admin/zones', {}, { country: row.code })}
              aria-current={countryCode === row.code ? 'page' : undefined}
              className={
                countryCode === row.code
                  ? 'rounded-lg bg-bemz-600 px-3 py-1.5 text-sm font-semibold text-white'
                  : 'rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-700 hover:border-bemz-400'
              }
            >
              {row.name} · {row.currency}
              <span className="tabular ml-1.5 text-xs opacity-80">
                {row._count.deliveryZones} zone{row._count.deliveryZones === 1 ? '' : 's'} / {row._count.districts} towns
              </span>
            </Link>
          ))}
        </div>

        <p className="mt-3 text-xs text-ink-500">
          VAT is added at checkout per country: {countries.map((row) => `${row.name} ${row.taxLabel} ${row.taxRateBps / 100}%`).join(' · ')}.
        </p>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Zones</h2>
          <p className="text-xs text-ink-500">{snapshots.length} priced area{snapshots.length === 1 ? '' : 's'}</p>
        </div>

        {snapshots.length === 0 ? (
          <EmptyState
            title="Nothing is priced here"
            description="No zone exists for this filter, which means no town in it can be checked out to. Zones are created by the seed or by hand in the database; this screen changes the ones that exist."
          />
        ) : (
          <div className="divide-y divide-ink-100">
            {snapshots.map((zone) => (
              <div key={zone.id}>
                <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
                  <Badge tone={COUNTRY_TONE[zone.country] ?? 'neutral'}>{zone.country}</Badge>
                  <span className="tabular text-xs text-ink-500">{zone.code}</span>
                  {!zone.isActive && <Badge tone="danger">closed</Badge>}
                  {zone.isActive && zone.districtCount === 0 && <Badge tone="warning">no towns attached</Badge>}
                  {zone.cashOnDeliveryAllowed ? (
                    <Badge tone="neutral">cash on delivery ok</Badge>
                  ) : (
                    <Badge tone="neutral">prepaid only</Badge>
                  )}
                  <span className="tabular ml-auto text-xs text-ink-500">
                    {money(zone.baseFeeMinor, zone.currency)} base ·{' '}
                    <span className="normal-case">{etaLabel(zone.estimatedDaysMin, zone.estimatedDaysMax)}</span>
                  </span>
                </div>
                <ZoneEditor zone={zone} />
                {zone.freeOverMinor !== null && (
                  <p className="px-5 pb-4 text-xs text-ink-500">
                    Free delivery over {money(zone.freeOverMinor, zone.currency)} — a basket that crosses it pays nothing, so a
                    rider&rsquo;s real cost has to stay under the margin that threshold assumes.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Towns we cannot deliver to yet</h2>
          <p className="mt-1 text-xs text-ink-600">
            {unreachable.length} town{unreachable.length === 1 ? '' : 's'} outside an open zone. A buyer in one of these sees the
            address form reject their own town, so coverage is worth expanding deliberately: attach the town to a zone whose fee you
            would actually pay a rider with.
          </p>
        </div>
        <DistrictZoneForm districts={unreachable} zones={zoneOptions} />
      </section>
    </div>
  );
}
