'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { fromMinor, toMinor, type CurrencyCode } from '@/lib/money';
import { money } from '@/lib/client/format';
import { Button } from '@/components/ui/button';
import { SelectField, SwitchField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/toast';

export interface ZoneSnapshot {
  id: number;
  code: string;
  name: string;
  country: string;
  currency: CurrencyCode;
  baseFeeMinor: number;
  perKgFeeMinor: number;
  freeOverMinor: number | null;
  estimatedDaysMin: number;
  estimatedDaysMax: number;
  cashOnDeliveryAllowed: boolean;
  isActive: boolean;
  districtCount: number;
}

const major = (minorUnits: number, currency: CurrencyCode) => String(fromMinor(minorUnits, currency));

/**
 * `PATCH /api/admin/zones/{id}`
 *
 * Only the fields that actually moved are sent, because the route refuses an empty patch and the
 * audit row is meant to read as "the fee went from 5,000 to 8,000", not as a rewrite of the whole
 * zone on every save. An order snapshots its own fee at checkout, so nothing typed here touches a
 * parcel already on a motorbike.
 */
export function ZoneEditor({ zone }: { zone: ZoneSnapshot }) {
  const router = useRouter();
  const toast = useToast();

  const [baseFee, setBaseFee] = useState(major(zone.baseFeeMinor, zone.currency));
  const [perKg, setPerKg] = useState(major(zone.perKgFeeMinor, zone.currency));
  const [freeOver, setFreeOver] = useState(zone.freeOverMinor === null ? '' : major(zone.freeOverMinor, zone.currency));
  const [daysMin, setDaysMin] = useState(String(zone.estimatedDaysMin));
  const [daysMax, setDaysMax] = useState(String(zone.estimatedDaysMax));
  const [cashOnDelivery, setCashOnDelivery] = useState(zone.cashOnDeliveryAllowed);
  const [isActive, setIsActive] = useState(zone.isActive);

  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});

  /** Major-unit text to minor units, or `null` when the box is not a usable amount. */
  function parseMinor(raw: string, field: string, { required = true } = {}) {
    const trimmed = raw.trim();
    if (trimmed === '') return required ? null : 'clear';
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) {
      setIssues((current) => ({ ...current, [field]: 'Write a number of whole shillings, like 5000' }));
      return null;
    }
    return toMinor(value, zone.currency);
  }

  const unchanged =
    toMinor(Number(baseFee || 0), zone.currency) === zone.baseFeeMinor &&
    toMinor(Number(perKg || 0), zone.currency) === zone.perKgFeeMinor &&
    (freeOver.trim() === '' ? zone.freeOverMinor === null : toMinor(Number(freeOver), zone.currency) === zone.freeOverMinor) &&
    Number(daysMin || 0) === zone.estimatedDaysMin &&
    Number(daysMax || 0) === zone.estimatedDaysMax &&
    cashOnDelivery === zone.cashOnDeliveryAllowed &&
    isActive === zone.isActive;

  async function save() {
    setIssues({});
    const base = parseMinor(baseFee, 'baseFeeMinor');
    const kg = parseMinor(perKg, 'perKgFeeMinor', { required: false });
    const over = freeOver.trim() === '' ? 'clear' : parseMinor(freeOver, 'freeOverMinor', { required: false });
    const min = Number(daysMin);
    const max = Number(daysMax);
    if (base === null || kg === null || over === null) return;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1) {
      setIssues({ form: 'Transit days are whole numbers — 1 day minimum on the slowest promise' });
      return;
    }
    if (min > max) {
      setIssues({ form: 'The fastest promise cannot be longer than the slowest one' });
      return;
    }

    const patch: Record<string, unknown> = {};
    if (base !== zone.baseFeeMinor) patch.baseFeeMinor = base;
    if (kg !== zone.perKgFeeMinor) patch.perKgFeeMinor = kg;
    if (over === 'clear' ? zone.freeOverMinor !== null : over !== zone.freeOverMinor) patch.freeOverMinor = over === 'clear' ? null : over;
    if (min !== zone.estimatedDaysMin) patch.estimatedDaysMin = min;
    if (max !== zone.estimatedDaysMax) patch.estimatedDaysMax = max;
    if (cashOnDelivery !== zone.cashOnDeliveryAllowed) patch.cashOnDeliveryAllowed = cashOnDelivery;
    if (isActive !== zone.isActive) patch.isActive = isActive;

    if (Object.keys(patch).length === 0) {
      setIssues({ form: 'Nothing changed — the zone already says this' });
      return;
    }

    setBusy(true);
    try {
      await api.patch(`/api/admin/zones/${zone.id}`, patch);
      toast.push(`${zone.name} repriced. New quotes only — orders keep the fee they were shown.`, 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(Object.keys(failure.issues).length > 0 ? failure.issues : { form: failure.message });
        toast.push(failure.message, 'error');
      } else {
        setIssues({ form: 'The zone did not save — try again' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink-900">{zone.name}</p>
        <p className="tabular text-xs text-ink-500">
          {zone.code} · {zone.districtCount} district{zone.districtCount === 1 ? '' : 's'} · currently {money(zone.baseFeeMinor, zone.currency)}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label={`Base delivery fee (${zone.currency})`}
          value={baseFee}
          onChange={(event) => setBaseFee(event.target.value)}
          inputMode="numeric"
          required
          error={issues.baseFeeMinor}
          hint="What a parcel costs inside this zone."
        />
        <TextField
          label={`Extra per kilogram (${zone.currency})`}
          value={perKg}
          onChange={(event) => setPerKg(event.target.value)}
          inputMode="numeric"
          error={issues.perKgFeeMinor}
          hint="0 charges every parcel the same, whatever it weighs."
        />
        <TextField
          label={`Free delivery over (${zone.currency})`}
          value={freeOver}
          onChange={(event) => setFreeOver(event.target.value)}
          inputMode="numeric"
          error={issues.freeOverMinor}
          hint="Leave blank for no free-delivery threshold."
        />
        <TextField label="Fastest days" value={daysMin} onChange={(event) => setDaysMin(event.target.value)} inputMode="numeric" required />
        <TextField label="Slowest days" value={daysMax} onChange={(event) => setDaysMax(event.target.value)} inputMode="numeric" required />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchField
          label="Cash on delivery allowed here"
          description="Off means the buyer pays by mobile money or card before the parcel moves."
          checked={cashOnDelivery}
          onChange={setCashOnDelivery}
        />
        <SwitchField
          label="Zone is open"
          description="Closing it hides the zone from every district in it, so those towns stop checkouting."
          checked={isActive}
          onChange={setIsActive}
        />
      </div>

      {issues.form && (
        <p role="alert" className="rounded-card bg-clay-50 px-3 py-2 text-sm text-clay-800">
          {issues.form}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button loading={busy} disabled={unchanged} onClick={() => void save()}>
          Save zone
        </Button>
        {unchanged && <p className="text-xs text-ink-500">Saved as it stands.</p>}
      </div>
    </div>
  );
}

/**
 * `POST /api/admin/zones/districts`
 *
 * This is the switch that turns a town on. A district with no zone returns `zone: null` to every
 * buyer and cannot be checked out to, so coverage does not expand by announcing it — it expands
 * when somebody moves the town into a priced zone of the same country.
 */
export function DistrictZoneForm({
  districts,
  zones,
}: {
  districts: { id: number; name: string; code: string; country: string }[];
  zones: { id: number; name: string; code: string; country: string; currency: CurrencyCode; baseFeeMinor: number }[];
}) {
  const router = useRouter();
  const toast = useToast();

  const [districtId, setDistrictId] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = districts.find((district) => String(district.id) === districtId) ?? null;
  const candidates = useMemo(() => (chosen ? zones.filter((zone) => zone.country === chosen.country) : zones), [zones, chosen]);

  async function assign() {
    if (!districtId || !zoneId) {
      setError('Pick the town and the zone it should price against');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<{ name: string; zone: { name: string } | null }>('/api/admin/zones/districts', {
        districtId: Number(districtId),
        zoneId: Number(zoneId),
      });
      toast.push(`${result.name} now delivers in ${result.zone?.name ?? 'the new zone'}.`, 'success');
      setDistrictId('');
      setZoneId('');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'The district did not move — try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Town with no working delivery"
          value={districtId}
          onChange={(event) => {
            setDistrictId(event.target.value);
            setZoneId('');
          }}
          placeholder={districts.length === 0 ? 'Every town is priced' : 'Choose a district'}
          options={districts.map((district) => ({
            value: String(district.id),
            label: `${district.name} (${district.code}) — ${district.country}`,
          }))}
          disabled={districts.length === 0}
          hint="Districts already in an open zone are not listed here."
        />
        <SelectField
          label="Move it into"
          value={zoneId}
          onChange={(event) => setZoneId(event.target.value)}
          placeholder={chosen ? 'Choose a zone' : 'Pick the town first'}
          options={candidates.map((zone) => ({
            value: String(zone.id),
            label: `${zone.name} — ${money(zone.baseFeeMinor, zone.currency)}, ${zone.country}`,
          }))}
          hint={chosen ? `Only ${chosen.country} zones can price a ${chosen.country} town.` : 'A Ugandan fee on a Kenyan town would bill the wrong currency.'}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-card bg-clay-50 px-3 py-2 text-sm text-clay-800">
          {error}
        </p>
      )}

      <Button loading={busy} disabled={!districtId || !zoneId} onClick={() => void assign()}>
        Open delivery there
      </Button>
    </div>
  );
}
