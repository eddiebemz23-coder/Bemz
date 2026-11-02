'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiFailure } from '@/lib/client/api';
import { REGIONS, type RegionInfo } from '@/lib/client/regions';
import type { AddressView, DistrictRow } from '@/lib/client/types';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextField, TextAreaField } from '@/components/ui/field';
import { PhoneInput } from '@/components/auth/phone-input';

interface DistrictList {
  deliverable: DistrictRow[];
  unreachable: { id: number; name: string; code: string; country: string }[];
}

/**
 * One form for both new stops and edits, because the fields are the same and the server already
 * treats `PATCH` as partial.
 *
 * The district is the only required geographic choice: it decides the delivery zone, so it
 * decides the fee and the ETA on every future order to this stop. Districts we do not serve yet
 * are listed and disabled instead of hidden, so nobody discovers the missing coverage at checkout.
 */
export function AddressForm({
  address,
  country,
  onCountryChange,
  onCancel,
  onSaved,
}: {
  address: AddressView | null;
  country: 'UG' | 'KE';
  onCountryChange: (next: 'UG' | 'KE') => void;
  onCancel: () => void;
  onSaved: (saved: AddressView) => void;
}) {
  const [districts, setDistricts] = useState<DistrictRow[] | null>(null);
  const [unreachable, setUnreachable] = useState<{ id: number; name: string }[]>([]);
  const [label, setLabel] = useState(address?.label ?? '');
  const [recipientName, setRecipientName] = useState(address?.recipientName ?? '');
  const [recipientPhone, setRecipientPhone] = useState(address?.recipientPhone ?? '');
  const [alternativePhone, setAlternativePhone] = useState(address?.alternativePhone ?? '');
  const [districtId, setDistrictId] = useState<string>(address ? String(address.districtId) : '');
  const [subcounty, setSubcounty] = useState(address?.subcounty ?? '');
  const [parish, setParish] = useState(address?.parish ?? '');
  const [village, setVillage] = useState(address?.village ?? '');
  const [streetAddress, setStreetAddress] = useState(address?.streetAddress ?? '');
  const [nearestLandmark, setNearestLandmark] = useState(address?.nearestLandmark ?? '');
  const [deliveryNote, setDeliveryNote] = useState(address?.deliveryNote ?? '');
  const [pinCode, setPinCode] = useState(address?.pinCode ?? '');
  const [isDefault, setIsDefault] = useState(address?.isDefault ?? false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const region: RegionInfo = REGIONS[country];

  useEffect(() => {
    let cancelled = false;
    setDistricts(null);
    api
      .get<DistrictList>(`/api/geo/districts?country=${country}`)
      .then((list) => {
        if (cancelled) return;
        setDistricts(list.deliverable);
        setUnreachable(list.unreachable.map((district) => ({ id: district.id, name: district.name })));
      })
      .catch(() => {
        if (!cancelled) setDistricts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [country]);

  // Moving to the other market invalidates the district that was chosen; keeping a stale id would
  // price a Kampala parcel against a Nairobi zone.
  useEffect(() => {
    if (!districts) return;
    if (districtId && !districts.some((district) => String(district.id) === districtId)) setDistrictId('');
  }, [districts, districtId]);

  const chosenDistrict = useMemo(
    () => districts?.find((district) => String(district.id) === districtId) ?? null,
    [districts, districtId],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssues({});

    const body = {
      label: label.trim() || undefined,
      recipientName: recipientName.trim(),
      recipientPhone: recipientPhone.trim(),
      alternativePhone: alternativePhone.trim() || undefined,
      districtId: Number(districtId),
      subcounty: subcounty.trim() || undefined,
      parish: parish.trim() || undefined,
      village: village.trim() || undefined,
      streetAddress: streetAddress.trim() || undefined,
      nearestLandmark: nearestLandmark.trim() || undefined,
      deliveryNote: deliveryNote.trim() || undefined,
      pinCode: pinCode.trim() || undefined,
      isDefault,
    };

    try {
      const saved = address
        ? await api.patch<AddressView>(`/api/me/addresses/${address.id}`, body)
        : await api.post<AddressView>('/api/me/addresses', body);
      onSaved(saved);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(failure.issues);
      } else {
        setIssues({ form: 'Could not save this address — check your connection and try again' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Market">
        {(['UG', 'KE'] as const).map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => onCountryChange(code)}
            aria-pressed={code === country}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              code === country ? 'bg-bemz-600 font-semibold text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
            }`}
          >
            {REGIONS[code].name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name this stop"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={30}
          list="address-labels"
          placeholder="Home, Office, Stall"
          error={issues.label}
          hint="Checkout lists your saved stops by this name."
        />
        <TextField
          label="Who receives it"
          value={recipientName}
          onChange={(event) => setRecipientName(event.target.value)}
          maxLength={80}
          required
          autoComplete="name"
          error={issues.recipientName}
        />
      </div>

      <datalist id="address-labels">
        <option value="Home" />
        <option value="Office" />
        <option value="Shop / stall" />
        <option value="Parents' house" />
      </datalist>

      <div className="grid gap-4 sm:grid-cols-2">
        <PhoneInput
          label="Recipient phone"
          value={recipientPhone}
          onChange={setRecipientPhone}
          region={country}
          onRegionChange={onCountryChange}
          error={issues.recipientPhone}
        />
        <PhoneInput
          label="Backup phone (optional)"
          value={alternativePhone}
          onChange={setAlternativePhone}
          region={country}
          onRegionChange={onCountryChange}
          required={false}
          error={issues.alternativePhone}
        />
      </div>

      <SelectField
        label="District"
        value={districtId}
        onChange={(event) => setDistrictId(event.target.value)}
        required
        disabled={districts === null}
        placeholder={districts === null ? 'Loading districts…' : 'Choose where the parcel goes'}
        error={issues.districtId}
        options={(districts ?? []).map((district) => ({
          value: String(district.id),
          label: district.zone
            ? `${district.name} — ${district.zone.name} (${district.zone.estimatedDaysMin}-${district.zone.estimatedDaysMax} days)`
            : `${district.name} — no delivery zone yet`,
          disabled: !district.zone,
        }))}
        hint="The district fixes the delivery fee band and how long the rider takes."
      />

      {unreachable.length > 0 && (
        <p className="rounded-card bg-ink-50 px-3 py-2 text-xs text-ink-600">
          Not served yet: {unreachable.slice(0, 6).map((district) => district.name).join(', ')}
          {unreachable.length > 6 ? ` and ${unreachable.length - 6} more` : ''}. Pick the nearest town and arrange a
          pickup there, or ask the seller whether they deliver to you.
        </p>
      )}

      {chosenDistrict?.zone && (
        <p className="text-xs text-bemz-700">
          {chosenDistrict.zone.name}: {chosenDistrict.zone.baseFeeMinor > 0 ? 'delivery fee applies' : 'no delivery fee'} ·{' '}
          {chosenDistrict.zone.estimatedDaysMin}-{chosenDistrict.zone.estimatedDaysMax} days
          {chosenDistrict.zone.cashOnDeliveryAllowed ? ' · cash on delivery allowed' : ' · pay by mobile money or card'}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Sub-county" value={subcounty} onChange={(event) => setSubcounty(event.target.value)} maxLength={80} error={issues.subcounty} />
        <TextField label="Parish" value={parish} onChange={(event) => setParish(event.target.value)} maxLength={80} error={issues.parish} />
        <TextField label="Village / cell" value={village} onChange={(event) => setVillage(event.target.value)} maxLength={80} error={issues.village} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Street or estate"
          value={streetAddress}
          onChange={(event) => setStreetAddress(event.target.value)}
          maxLength={160}
          placeholder="Ntinda–Bowden Lake rd, opposite Quickmart"
          error={issues.streetAddress}
        />
        <TextField
          label={country === 'KE' ? 'Postal pin code' : 'Box / code (optional)'}
          value={pinCode}
          onChange={(event) => setPinCode(event.target.value)}
          maxLength={12}
          error={issues.pinCode}
        />
      </div>

      <TextAreaField
        label="Nearest landmark"
        rows={2}
        value={nearestLandmark}
        onChange={(event) => setNearestLandmark(event.target.value)}
        maxLength={160}
        placeholder="Blue gate next to the mobile-money agent"
        error={issues.nearestLandmark}
        hint="In most of both cities this is what the rider actually uses to find you."
      />

      <TextAreaField
        label="Note for the rider (optional)"
        rows={2}
        value={deliveryNote}
        onChange={(event) => setDeliveryNote(event.target.value)}
        maxLength={240}
        placeholder="Call when you reach the second gate; dogs are inside."
        error={issues.deliveryNote}
      />

      <CheckboxField
        label="Make this my default delivery stop"
        checked={isDefault}
        onChange={(event) => setIsDefault(event.target.checked)}
        description={address?.isDefault ? 'Already the default — leave ticked to keep it.' : `Checkout will start with this address in ${region.name}.`}
      />

      {issues.form && (
        <p role="alert" className="text-sm text-clay-700">
          {issues.form}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={!recipientName.trim() || !recipientPhone.trim() || !districtId}>
          {address ? 'Save address' : 'Add address'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
