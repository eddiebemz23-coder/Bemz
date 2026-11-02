import 'server-only';
import { Prisma, prisma } from '../prisma';
import { notFound, unprocessable } from '../http';
import type { districtQuerySchema } from '../validation/commerce';
import type { z } from 'zod';

/**
 * Delivery geography for the two launch markets.
 *
 * Uganda has 130-plus districts and Kenya 47 counties; both live in one `District` table so
 * a shipping rule reads the same either way. Price is not per district but per
 * `DeliveryZone`, and a district with no zone is unreachable — the checkout must say so
 * rather than quote a guessed fee.
 */

const districtSelect = {
  id: true,
  name: true,
  code: true,
  isMajor: true,
  countryId: true,
  regionId: true,
  region: { select: { id: true, name: true } },
  zone: {
    select: {
      id: true,
      name: true,
      code: true,
      baseFeeMinor: true,
      perKgFeeMinor: true,
      freeOverMinor: true,
      estimatedDaysMin: true,
      estimatedDaysMax: true,
      cashOnDeliveryAllowed: true,
      isActive: true,
    },
  },
  country: { select: { code: true, name: true, currency: true } },
} satisfies Prisma.DistrictSelect;

type DistrictRow = Prisma.DistrictGetPayload<{ select: typeof districtSelect }>;

function toDistrict(row: DistrictRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    isMajor: row.isMajor,
    region: row.region?.name ?? null,
    country: row.country.code,
    currency: row.country.currency,
    // `null` here means "we do not deliver there yet" — the UI must disable the option.
    zone: row.zone
      ? {
          id: row.zone.id,
          name: row.zone.name,
          code: row.zone.code,
          baseFeeMinor: row.zone.baseFeeMinor,
          perKgFeeMinor: row.zone.perKgFeeMinor,
          freeOverMinor: row.zone.freeOverMinor,
          estimatedDaysMin: row.zone.estimatedDaysMin,
          estimatedDaysMax: row.zone.estimatedDaysMax,
          cashOnDeliveryAllowed: row.zone.cashOnDeliveryAllowed,
          isActive: row.zone.isActive,
        }
      : null,
  };
}

/**
 * `GET /api/geo/districts`
 *
 * The dropdown behind the address form and the checkout district picker. Default is
 * deliverable-only, because a buyer who picks a district we cannot price gets a dead
 * checkout at the next step.
 */
export async function listDistricts(query: z.infer<typeof districtQuerySchema>) {
  const rows = await prisma.district.findMany({
    where: {
      ...(query.country ? { country: { code: query.country } } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q.toUpperCase(), mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(query.majorOnly === 'true' ? { isMajor: true } : {}),
    },
    select: districtSelect,
    orderBy: [{ countryId: 'asc' }, { isMajor: 'desc' }, { name: 'asc' }],
  });

  const districts = rows.map(toDistrict);
  return {
    // Reachable first: the common case is a buyer scanning for their own town.
    deliverable: districts.filter((district) => district.zone !== null && district.zone.isActive),
    unreachable: districts
      .filter((district) => district.zone === null || !district.zone.isActive)
      .map((district) => ({ id: district.id, name: district.name, code: district.code, country: district.country })),
  };
}

/** `GET /api/geo/districts/[id]` — the single lookup the checkout confirmation uses. */
export async function getDistrict(id: number) {
  const row = await prisma.district.findUnique({ where: { id }, select: districtSelect });
  if (!row) throw notFound('That delivery area does not exist');
  return toDistrict(row);
}

/**
 * `GET /api/geo/zones`
 *
 * The ops view of shipping: every priced zone, how many districts it covers, and whether
 * cash on delivery is switched on there.
 */
export async function listZones(countryCode?: 'UG' | 'KE') {
  const zones = await prisma.deliveryZone.findMany({
    where: { ...(countryCode ? { country: { code: countryCode } } : {}) },
    include: {
      country: { select: { code: true, name: true, currency: true } },
      _count: { select: { districts: true } },
    },
    orderBy: [{ countryId: 'asc' }, { baseFeeMinor: 'asc' }],
  });

  return zones.map((zone) => ({
    id: zone.id,
    code: zone.code,
    name: zone.name,
    country: zone.country.code,
    currency: zone.country.currency,
    baseFeeMinor: zone.baseFeeMinor,
    perKgFeeMinor: zone.perKgFeeMinor,
    freeOverMinor: zone.freeOverMinor,
    estimatedDays: { min: zone.estimatedDaysMin, max: zone.estimatedDaysMax },
    cashOnDeliveryAllowed: zone.cashOnDeliveryAllowed,
    isActive: zone.isActive,
    districtCount: zone._count.districts,
  }));
}

/**
 * `GET /api/geo/countries`
 *
 * Small and stable enough to cache hard: the currency switcher, the phone-prefix input and
 * the VAT label all read this.
 */
export async function listCountries() {
  const rows = await prisma.country.findMany({
    where: { isActive: true },
    select: {
      code: true,
      name: true,
      currency: true,
      phonePrefix: true,
      taxRateBps: true,
      taxLabel: true,
      _count: { select: { districts: true, deliveryZones: true, shops: true } },
    },
    orderBy: { id: 'asc' },
  });

  return rows;
}

/**
 * `PATCH /api/admin/zones/[id]`
 *
 * Repricing a zone only affects orders created afterwards — an order snapshots its fee at
 * checkout, so a buyer who already saw UGX 5,000 is never re-charged mid-flight.
 */
export async function updateZone(
  zoneId: number,
  patch: {
    baseFeeMinor?: number;
    perKgFeeMinor?: number;
    freeOverMinor?: number | null;
    estimatedDaysMin?: number;
    estimatedDaysMax?: number;
    cashOnDeliveryAllowed?: boolean;
    isActive?: boolean;
  },
  actorId: string,
) {
  const zone = await prisma.deliveryZone.findUnique({ where: { id: zoneId } });
  if (!zone) throw notFound('That delivery zone does not exist');

  const daysMin = patch.estimatedDaysMin ?? zone.estimatedDaysMin;
  const daysMax = patch.estimatedDaysMax ?? zone.estimatedDaysMax;
  if (daysMin > daysMax) throw unprocessable('The fastest promise cannot be longer than the slowest one');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.deliveryZone.update({
      where: { id: zoneId },
      data: {
        ...(patch.baseFeeMinor !== undefined ? { baseFeeMinor: patch.baseFeeMinor } : {}),
        ...(patch.perKgFeeMinor !== undefined ? { perKgFeeMinor: patch.perKgFeeMinor } : {}),
        ...(patch.freeOverMinor !== undefined ? { freeOverMinor: patch.freeOverMinor } : {}),
        ...(patch.cashOnDeliveryAllowed !== undefined ? { cashOnDeliveryAllowed: patch.cashOnDeliveryAllowed } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
        estimatedDaysMin: daysMin,
        estimatedDaysMax: daysMax,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ZONE_UPDATE',
        entity: 'DELIVERY_ZONE',
        entityId: String(zoneId),
        before: {
          baseFeeMinor: zone.baseFeeMinor,
          perKgFeeMinor: zone.perKgFeeMinor,
          freeOverMinor: zone.freeOverMinor,
          estimatedDaysMin: zone.estimatedDaysMin,
          estimatedDaysMax: zone.estimatedDaysMax,
          cashOnDeliveryAllowed: zone.cashOnDeliveryAllowed,
          isActive: zone.isActive,
        },
        after: {
          baseFeeMinor: row.baseFeeMinor,
          perKgFeeMinor: row.perKgFeeMinor,
          freeOverMinor: row.freeOverMinor,
          estimatedDaysMin: row.estimatedDaysMin,
          estimatedDaysMax: row.estimatedDaysMax,
          cashOnDeliveryAllowed: row.cashOnDeliveryAllowed,
          isActive: row.isActive,
        },
      },
    });

    return row;
  });

  return {
    id: updated.id,
    name: updated.name,
    baseFeeMinor: updated.baseFeeMinor,
    freeOverMinor: updated.freeOverMinor,
    estimatedDays: { min: updated.estimatedDaysMin, max: updated.estimatedDaysMax },
    isActive: updated.isActive,
  };
}

/** Assigning a district to a zone is the normal way a new area opens for delivery. */
export async function assignDistrictZone(districtId: number, zoneId: number, actorId: string) {
  const district = await prisma.district.findUnique({ where: { id: districtId }, select: { id: true, name: true, zoneId: true, countryId: true } });
  if (!district) throw notFound('That delivery area does not exist');

  const zone = await prisma.deliveryZone.findUnique({ where: { id: zoneId }, select: { id: true, countryId: true, name: true } });
  if (!zone) throw notFound('That delivery zone does not exist');

  // A Kampala fee applied to a Nairobi district would be wrong in two currencies at once.
  if (zone.countryId !== district.countryId) {
    throw unprocessable('That zone belongs to another country');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.district.update({ where: { id: districtId }, data: { zoneId }, select: districtSelect });
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'ZONE_UPDATE',
        entity: 'DELIVERY_ZONE',
        entityId: String(zoneId),
        before: { districtId, previousZoneId: district.zoneId },
        after: { districtId, zoneId },
        reason: `Moved ${district.name} to ${zone.name}`,
      },
    });
    return row;
  });

  return toDistrict(updated);
}
