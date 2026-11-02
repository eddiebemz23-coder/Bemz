'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, ApiFailure } from '@/lib/client/api';
import type { AddressView } from '@/lib/client/types';
import { displayPhone } from '@/lib/client/format';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/toast';
import { AddressForm } from '@/components/account/address-form';

/**
 * The address book.
 *
 * A saved stop is what makes checkout a two-tap job on a phone, and it carries its delivery zone
 * with it, so each card states the ETA and whether cash on delivery is allowed there before the
 * buyer commits. Removing one is safe by design: every order keeps its own JSON copy of the
 * address, so the rider's instructions on a parcel already in motion cannot change.
 */
export function AddressBook({ addresses: initial, defaultCountry }: { addresses: AddressView[]; defaultCountry: 'UG' | 'KE' }) {
  const router = useRouter();
  const toast = useToast();
  const [addresses, setAddresses] = useState(initial);
  const [country, setCountry] = useState<'UG' | 'KE'>(defaultCountry);
  const [editing, setEditing] = useState<AddressView | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function handleSaved(saved: AddressView) {
    // Re-read the book rather than splicing one row in: making a stop the default moves the badge
    // to a different card, and only the server knows which one.
    const fresh = await api.get<AddressView[]>('/api/me/addresses').catch(() => addresses);
    setAddresses(fresh);
    setEditing(null);
    toast.push(
      `${saved.label ?? 'Address'} saved. Delivery to ${saved.districtName} takes ${saved.estimatedDaysMin}-${saved.estimatedDaysMax} days.`,
      'success',
    );
    router.refresh();
  }

  async function makeDefault(address: AddressView) {
    setBusyId(address.id);
    const result = await api.patch<AddressView>(`/api/me/addresses/${address.id}`, { isDefault: true }).catch((failure) => {
      toast.push(failure instanceof ApiFailure ? failure.message : 'Could not change the default', 'error');
      return null;
    });
    if (result) setAddresses((current) => current.map((row) => (row.id === result.id ? result : { ...row, isDefault: false })));
    setBusyId(null);
    router.refresh();
  }

  async function remove(address: AddressView) {
    setBusyId(address.id);
    try {
      await api.del(`/api/me/addresses/${address.id}`);
      setAddresses((current) => current.filter((row) => row.id !== address.id));
      toast.push(`Removed ${address.label ?? address.districtName}. Orders already placed keep their own delivery copy.`, 'success');
    } catch (failure) {
      toast.push(failure instanceof ApiFailure ? failure.message : 'Could not remove that address', 'error');
    } finally {
      setConfirmDelete(null);
      setBusyId(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600">
          {addresses.length === 0
            ? 'No saved stops yet.'
            : `${addresses.length} saved ${addresses.length === 1 ? 'stop' : 'stops'} — the marked one is used first at checkout.`}
        </p>
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden />
          Add a delivery address
        </Button>
      </div>

      {addresses.length === 0 && (
        <p className="card px-4 py-6 text-center text-sm text-ink-600">
          Add where the rider should bring your parcel. The district decides the delivery fee, so it is worth getting
          right once.
        </p>
      )}

      <ul className="grid gap-3 sm:grid-cols-2">
        {addresses.map((address) => {
          const locality = [address.subcounty, address.parish, address.village].filter(Boolean).join(' · ');
          const place = [locality || address.districtName, address.pinCode].filter(Boolean).join(' · ');

          return (
            <li key={address.id} className={`card flex flex-col gap-2 p-4 ${address.isDefault ? 'ring-1 ring-bemz-300' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900">
                  <MapPin className="size-4 text-bemz-600" aria-hidden />
                  {address.label ?? address.districtName}
                </p>
                {address.isDefault && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-bemz-50 px-2 py-0.5 text-[11px] font-medium text-bemz-800">
                    <Check className="size-3" aria-hidden />
                    Default
                  </span>
                )}
              </div>

              <p className="text-sm text-ink-800">
                {address.recipientName}
                <span className="block text-ink-600">{displayPhone(address.recipientPhone, address.countryCode === 'KE' ? '254' : '256')}</span>
                {address.alternativePhone && <span className="block text-xs text-ink-500">Also {displayPhone(address.alternativePhone)}</span>}
              </p>

              <address className="not-italic text-sm text-ink-600">
                {address.streetAddress && <span className="block">{address.streetAddress}</span>}
                <span className="block">{place}</span>
                {address.nearestLandmark && <span className="block">Near: {address.nearestLandmark}</span>}
                {address.deliveryNote && <span className="block text-xs text-ink-500">Rider note: {address.deliveryNote}</span>}
              </address>

              {address.zoneName ? (
                <p className="mt-auto rounded-card bg-ink-50 px-3 py-2 text-xs text-ink-600">
                  {address.zoneName} · {address.estimatedDaysMin}-{address.estimatedDaysMax} days ·{' '}
                  {address.cashOnDeliveryAllowed ? 'cash on delivery allowed' : 'pay by mobile money or card'}
                </p>
              ) : (
                <p className="mt-auto rounded-card bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  No delivery zone is mapped to {address.districtName} yet — sellers there will contact you to arrange
                  pickup.
                </p>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setCountry(address.countryCode);
                    setEditing(address);
                  }}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Edit
                </Button>
                {!address.isDefault && (
                  <Button variant="ghost" size="sm" loading={busyId === address.id} onClick={() => void makeDefault(address)}>
                    Use as default
                  </Button>
                )}
                {confirmDelete === address.id ? (
                  <span className="flex items-center gap-2">
                    <Button variant="danger" size="sm" onClick={() => void remove(address)}>
                      Confirm remove
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" size="sm" className="text-clay-700" onClick={() => setConfirmDelete(address.id)}>
                    <Trash2 className="size-3.5" aria-hidden />
                    Remove
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add a delivery address' : 'Edit this address'}
        description="The district sets the delivery fee band, so a parcel to Gulu and a parcel to Kampala are priced differently."
        size="lg"
      >
        {editing !== null && (
          <AddressForm
            address={editing === 'new' ? null : editing}
            country={country}
            onCountryChange={setCountry}
            onCancel={() => setEditing(null)}
            onSaved={(saved) => void handleSaved(saved)}
          />
        )}
      </Modal>
    </div>
  );
}
