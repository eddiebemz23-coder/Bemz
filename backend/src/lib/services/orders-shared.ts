import 'server-only';
import { Prisma, type ShippingAddress } from '../prisma';

type JsonObject = Prisma.JsonObject;

/** How long an unpaid order pins stock before the sweep releases it. */
export const PAYMENT_TTL_MS = 30 * 60_000;
/** A cash-on-delivery order waits for the buyer's OTP confirmation, then for the rider. */
export const COD_TTL_MS = 48 * 60 * 60_000;
/** Confirmed orders that nobody packs are expired so the reservation cannot outlive the demand. */
export const STALE_RESERVATION_MS = 7 * 24 * 60 * 60_000;

/**
 * The address is copied into the order as JSON instead of referenced.
 *
 * People move, rename their "Home" address and fix typos. A parcel delivered in December
 * must still show the address that was paid for in December, and a dispute needs the
 * landmark the rider was told to look for.
 */
export function buildOrderSnapshot(params: {
  address: ShippingAddress;
  districtName: string;
  zoneCode: string;
  zoneName: string;
}): JsonObject {
  const { address } = params;
  return {
    label: address.label,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    alternativePhone: address.alternativePhone,
    districtName: params.districtName,
    districtId: address.districtId,
    zoneCode: params.zoneCode,
    zoneName: params.zoneName,
    subcounty: address.subcounty,
    parish: address.parish,
    village: address.village,
    streetAddress: address.streetAddress,
    nearestLandmark: address.nearestLandmark,
    deliveryNote: address.deliveryNote,
    pinCode: address.pinCode,
    lat: address.lat == null ? null : Number(address.lat),
    lng: address.lng == null ? null : Number(address.lng),
    capturedAt: new Date().toISOString(),
  };
}

/** ETA window shown to the buyer on the confirmation page. */
export function estimatedDeliveryWindow(zone: { estimatedDaysMin: number; estimatedDaysMax: number }, now = new Date()) {
  const dayMs = 24 * 60 * 60_000;
  return {
    earliest: new Date(now.getTime() + zone.estimatedDaysMin * dayMs),
    latest: new Date(now.getTime() + zone.estimatedDaysMax * dayMs),
  };
}
