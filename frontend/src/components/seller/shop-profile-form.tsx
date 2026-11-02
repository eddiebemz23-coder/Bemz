'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { uploadMedia } from '@/lib/client/upload';
import { REGIONS } from '@/lib/client/regions';
import type { DistrictRow } from '@/lib/client/types';
import { Button } from '@/components/ui/button';
import { SelectField, SwitchField, TextAreaField, TextField } from '@/components/ui/field';
import { PhoneInput } from '@/components/auth/phone-input';
import { ListingImage } from '@/components/ui/listing-image';
import { useToast } from '@/components/toast';

const FULFILMENT: { value: string; label: string }[] = [
  { value: 'SELLER_DELIVERY', label: 'I send with a Bemz rider' },
  { value: 'SELLER_SELF_DELIVERY', label: 'I deliver with my own boda or driver' },
  { value: 'BUYER_PICKUP', label: 'Buyers collect from my shop' },
  { value: 'DIGITAL', label: 'Digital or airtime — nothing is carried' },
];

interface DistrictList {
  deliverable: DistrictRow[];
  unreachable: { id: number; name: string; code: string; country: string }[];
}

export interface ShopProfileInitial {
  shopId: string;
  name: string;
  slug: string;
  tagline: string | null;
  description: string | null;
  phone: string | null;
  whatsappNumber: string | null;
  email: string | null;
  streetAddress: string | null;
  defaultFulfilment: string;
  dispatchSlaHours: number;
  baseDistrictId: number | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  vacationMode: boolean;
  statusCode: string;
}

/**
 * `PATCH /api/seller/shop`, `POST /api/seller/shop/media`, `POST /api/seller/shop/vacation`,
 * `POST /api/seller/shop/close`
 *
 * The market is not in this form on purpose: the country fixes the currency of every live listing,
 * the VAT rate on every receipt and the zone map every delivery fee is quoted from, so changing it
 * would silently re-price a whole stall. Everything else a seller can edit is here.
 */
export function ShopProfileForm({ initial, countryCode }: { initial: ShopProfileInitial; countryCode: 'UG' | 'KE' }) {
  const router = useRouter();
  const toast = useToast();

  const [region, setRegion] = useState<'UG' | 'KE'>(countryCode);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [tagline, setTagline] = useState(initial.tagline ?? '');
  const [description, setDescription] = useState(initial.description ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [whatsappNumber, setWhatsappNumber] = useState(initial.whatsappNumber ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [streetAddress, setStreetAddress] = useState(initial.streetAddress ?? '');
  const [defaultFulfilment, setDefaultFulfilment] = useState(initial.defaultFulfilment);
  const [dispatchSlaHours, setDispatchSlaHours] = useState(String(initial.dispatchSlaHours));
  const [baseDistrictId, setBaseDistrictId] = useState(initial.baseDistrictId === null ? '' : String(initial.baseDistrictId));

  const [districts, setDistricts] = useState<DistrictRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setDistricts(null);
    api
      .get<DistrictList>(`/api/geo/districts?country=${region}`)
      .then((list) => {
        if (!cancelled) setDistricts(list.deliverable);
      })
      .catch(() => {
        if (!cancelled) setDistricts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [region]);

  const chosenDistrict = useMemo(
    () => districts?.find((district) => String(district.id) === baseDistrictId) ?? null,
    [districts, baseDistrictId],
  );

  const dirty =
    name !== initial.name ||
    slug !== initial.slug ||
    tagline !== (initial.tagline ?? '') ||
    description !== (initial.description ?? '') ||
    phone !== (initial.phone ?? '') ||
    whatsappNumber !== (initial.whatsappNumber ?? '') ||
    email !== (initial.email ?? '') ||
    streetAddress !== (initial.streetAddress ?? '') ||
    defaultFulfilment !== initial.defaultFulfilment ||
    Number(dispatchSlaHours) !== initial.dispatchSlaHours ||
    baseDistrictId !== (initial.baseDistrictId === null ? '' : String(initial.baseDistrictId));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssues({});
    try {
      const saved = await api.patch<{ slug: string }>('/api/seller/shop', {
        name: name.trim(),
        slug: slug.trim() !== initial.slug ? slug.trim() : undefined,
        tagline: tagline.trim(),
        description: description.trim(),
        phone: phone.trim(),
        whatsappNumber: whatsappNumber.trim(),
        email: email.trim(),
        streetAddress: streetAddress.trim(),
        defaultFulfilment,
        dispatchSlaHours: Number(dispatchSlaHours),
        baseDistrictId: baseDistrictId ? Number(baseDistrictId) : undefined,
      });
      toast.push(saved.slug !== initial.slug ? `Shop saved. Buyers now find you at /shop/${saved.slug}` : 'Shop saved.', 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        const parsed = failure.issues;
        setIssues(Object.keys(parsed).length > 0 ? parsed : { form: failure.message });
      } else {
        setIssues({ form: 'The shop was not saved — check your connection and try again' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <ShopMedia shopId={initial.shopId} logoUrl={initial.logoUrl} bannerUrl={initial.bannerUrl} />

      <form onSubmit={save} className="card space-y-5 p-5">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Shop details</h2>
          <p className="mt-1 text-xs text-ink-500">
            Based in {REGIONS[region].name}, priced in {REGIONS[region].currency}. The market itself cannot be changed
            once the stall is open.
          </p>
        </div>

        {issues.form && (
          <p role="alert" className="rounded-card bg-clay-50 px-3 py-2 text-sm text-clay-800">
            {issues.form}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Shop name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} error={issues.name} />
          <TextField
            label="Store link"
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            maxLength={60}
            leading={<span>bemz/shop/</span>}
            error={issues.slug}
            hint="Changing this breaks links you have already printed or shared on WhatsApp."
          />
        </div>

        <TextField label="One line buyers see under your name" value={tagline} onChange={(event) => setTagline(event.target.value)} maxLength={120} error={issues.tagline} />

        <TextAreaField label="About the shop" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={2000} error={issues.description} />

        <div className="grid gap-4 sm:grid-cols-2">
          <PhoneInput label="Shop phone" value={phone} onChange={setPhone} region={region} onRegionChange={setRegion} error={issues.phone} />
          <PhoneInput
            label="WhatsApp number (optional)"
            value={whatsappNumber}
            onChange={setWhatsappNumber}
            required={false}
            region={region}
            onRegionChange={setRegion}
            error={issues.whatsappNumber}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Email (optional)" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={160} error={issues.email} />
          <TextField
            label="Street or landmark (optional)"
            value={streetAddress}
            onChange={(event) => setStreetAddress(event.target.value)}
            maxLength={160}
            placeholder="Shop 14, Nakawa modern market"
            error={issues.streetAddress}
          />
        </div>

        <SelectField
          label="District you dispatch from"
          value={baseDistrictId}
          onChange={(event) => setBaseDistrictId(event.target.value)}
          required
          disabled={districts === null}
          placeholder={districts === null ? 'Loading districts…' : 'Choose your district'}
          error={issues.baseDistrictId}
          options={(districts ?? []).map((district) => ({
            value: String(district.id),
            label: district.zone ? `${district.name} — ${district.zone.name}` : `${district.name} — no delivery zone yet`,
            disabled: !district.zone,
          }))}
          hint="Decides the delivery fee and the days a buyer is quoted before ordering."
        />

        {chosenDistrict?.zone && (
          <p className="text-xs text-bemz-700">
            Buyers in {chosenDistrict.name} see {chosenDistrict.zone.name}: {chosenDistrict.zone.estimatedDaysMin}-
            {chosenDistrict.zone.estimatedDaysMax} days
            {chosenDistrict.zone.cashOnDeliveryAllowed ? ' · cash on delivery allowed' : ' · paid before delivery'}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="How you usually deliver"
            value={defaultFulfilment}
            onChange={(event) => setDefaultFulfilment(event.target.value)}
            options={FULFILMENT}
            error={issues.defaultFulfilment}
            hint="A new listing starts with this."
          />
          <TextField
            label="Hours until you hand the parcel over"
            type="number"
            inputMode="numeric"
            value={dispatchSlaHours}
            onChange={(event) => setDispatchSlaHours(event.target.value)}
            required
            min={1}
            max={336}
            error={issues.dispatchSlaHours}
            hint="Shown to buyers as your dispatch promise. 1–336 hours."
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-4">
          <Button type="submit" loading={busy} disabled={!dirty || !name.trim() || !phone.trim()}>
            {dirty ? 'Save shop' : 'Nothing to save'}
          </Button>
          <p className="text-xs text-ink-500">The stall stays live while you edit.</p>
        </div>
      </form>

      <div className="card space-y-4 p-5">
        <VacationSwitch on={initial.vacationMode} />
        {initial.statusCode !== 'CLOSED' && <CloseShopButton />}
      </div>
    </div>
  );
}

function ShopMedia({ shopId, logoUrl, bannerUrl }: { shopId: string; logoUrl: string | null; bannerUrl: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const logoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const [busyKind, setBusyKind] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function replace(kind: 'logo' | 'banner', file: File) {
    setBusyKind(kind);
    setError(null);
    try {
      const asset = await uploadMedia(file, { target: 'shop', shopId });
      await api.post('/api/seller/shop/media', { kind, url: asset.url, publicId: asset.publicId });
      toast.push(kind === 'logo' ? 'Logo updated.' : 'Banner updated.', 'success');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'The image did not upload — try again');
    } finally {
      setBusyKind(null);
    }
  }

  const slots: { kind: 'logo' | 'banner'; label: string; url: string | null; ratio: string; hint: string }[] = [
    { kind: 'logo', label: 'Logo', url: logoUrl, ratio: 'aspect-square', hint: 'Rounded to a circle in search results. A square image looks best.' },
    { kind: 'banner', label: 'Banner', url: bannerUrl, ratio: 'aspect-[8/3]', hint: 'The strip at the top of your stall page, 1200×450 or bigger.' },
  ];

  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Shop images</h2>
      {error && (
        <p role="alert" className="text-sm text-clay-700">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {slots.map((slot) => (
          <div key={slot.kind} className="space-y-2">
            <input
              ref={slot.kind === 'logo' ? logoInput : bannerInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void replace(slot.kind, file);
                event.target.value = '';
              }}
            />
            <ListingImage
              src={slot.url}
              alt={`${slot.label} for your shop`}
              className={`${slot.ratio} rounded-card ring-1 ring-inset ring-ink-200`}
              sizes="(min-width: 640px) 50vw, 100vw"
            />
            <p className="text-xs font-medium text-ink-800">{slot.label}</p>
            <p className="text-xs text-ink-500">{slot.hint}</p>
            <Button size="sm" variant="outline" loading={busyKind === slot.kind} onClick={() => (slot.kind === 'logo' ? logoInput : bannerInput).current?.click()}>
              {slot.url ? 'Replace' : 'Upload'}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function VacationSwitch({ on }: { on: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [checked, setChecked] = useState(on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    setChecked(next);
    try {
      await api.post('/api/seller/shop/vacation', { on: next });
      toast.push(
        next ? 'On holiday. Your listings still show, but buyers cannot order until you switch back.' : 'Back open — buyers can order again.',
        'success',
      );
      router.refresh();
    } catch (failure) {
      setChecked(!next);
      setError(failure instanceof ApiFailure ? failure.message : 'The switch did not take — try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <SwitchField
        label="Holiday mode"
        description={
          checked
            ? 'Buyers see your listings but checkout blocks them. Nothing is deleted and your ratings stay.'
            : 'Off means orders keep coming. Turn it on when you travel upcountry.'
        }
        checked={checked}
        disabled={busy}
        onChange={(next) => void toggle(next)}
      />
      {error && (
        <p role="alert" className="text-sm text-clay-700">
          {error}
        </p>
      )}
    </div>
  );
}

function CloseShopButton() {
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/seller/shop/close');
      toast.push('Shop closed. Orders in delivery were not — settle those first.', 'success');
      router.refresh();
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'The shop stayed open — try again');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-4">
        <p className="text-xs text-ink-500">
          Closing hides the stall and stops new orders. Every past order, review and payout record stays readable.
        </p>
        <Button variant="ghost" size="sm" className="text-clay-700" onClick={() => setConfirming(true)}>
          Close the shop
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-card border border-clay-200 bg-clay-50 p-4">
      <p className="text-sm font-semibold text-clay-800">Close your stall for good?</p>
      <p className="text-xs text-clay-700">
        Buyers can no longer order. You can still sign in to answer disputes and withdraw a payout. Bemz support has to
        reopen it for you.
      </p>
      {error && (
        <p role="alert" className="text-sm text-clay-800">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="danger" size="sm" loading={busy} onClick={() => void close()}>
          Yes, close it
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          Keep trading
        </Button>
      </div>
    </div>
  );
}
