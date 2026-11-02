'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { REGIONS } from '@/lib/client/regions';
import type { DistrictRow } from '@/lib/client/types';
import { Button } from '@/components/ui/button';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { PhoneInput } from '@/components/auth/phone-input';
import { useToast } from '@/components/toast';

interface DistrictList {
  deliverable: DistrictRow[];
  unreachable: { id: number; name: string; code: string; country: string }[];
}

interface CreatedShop {
  id: string;
  name: string;
  slug: string;
  status: string;
  kycStatus: string;
}
const FULFILMENT: { value: string; label: string }[] = [
  { value: 'SELLER_DELIVERY', label: 'I send with a Bemz rider' },
  { value: 'SELLER_SELF_DELIVERY', label: 'I deliver with my own boda or driver' },
  { value: 'BUYER_PICKUP', label: 'Buyers collect from my shop' },
  { value: 'DIGITAL', label: 'Digital or airtime — nothing is carried' },
];

/**
 * `POST /api/shops`
 *
 * Opening a stall is one form, not an application. The two fields that cannot be guessed — the
 * district you dispatch from and the phone a rider can call — are the two the platform prices and
 * audits everything else from, so both are required and the district list is fetched live rather
 * than typed.
 *
 * The store link is optional: left blank it is cut from the shop name, and a name that collides
 * with an existing stall gets digits appended by the server instead of being rejected.
 */
export function OpenShopForm({ defaultCountry }: { defaultCountry: 'UG' | 'KE' }) {
  const router = useRouter();
  const toast = useToast();

  const [country, setCountry] = useState<'UG' | 'KE'>(defaultCountry);
  const [districts, setDistricts] = useState<DistrictRow[] | null>(null);
  const [unreachable, setUnreachable] = useState<{ id: number; name: string }[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsappNumber, setWhatsappNumber] = useState('');
  const [email, setEmail] = useState('');
  const [baseDistrictId, setBaseDistrictId] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [defaultFulfilment, setDefaultFulfilment] = useState('SELLER_DELIVERY');
  const [dispatchSlaHours, setDispatchSlaHours] = useState('48');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

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

  // Switching markets must not leave a Kampala district submitted as a Nairobi dispatch base.
  useEffect(() => {
    if (!districts) return;
    if (baseDistrictId && !districts.some((district) => String(district.id) === baseDistrictId)) setBaseDistrictId('');
  }, [districts, baseDistrictId]);

  const chosenDistrict = useMemo(
    () => districts?.find((district) => String(district.id) === baseDistrictId) ?? null,
    [districts, baseDistrictId],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssues({});

    try {
      const shop = await api.post<CreatedShop>('/api/shops', {
        name: name.trim(),
        slug: slug.trim() || undefined,
        tagline: tagline.trim() || undefined,
        description: description.trim() || undefined,
        phone: phone.trim(),
        whatsappNumber: whatsappNumber.trim() || undefined,
        email: email.trim() || undefined,
        country,
        baseDistrictId: Number(baseDistrictId),
        streetAddress: streetAddress.trim() || undefined,
        defaultFulfilment,
        dispatchSlaHours: Number(dispatchSlaHours),
      });
      // The server may append digits to a link that collides with an existing stall, so the slug
      // it returns — not the one typed — is the address the seller should print on a sign.
      toast.push(`Shop is open. Buyers will find you at /shop/${shop.slug}`, 'success');
      // `refresh` first so the layout re-reads the session's shop and draws the dashboard shell
      // around the page we are about to show.
      router.refresh();
      router.push('/seller');
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(failure.issues);
        if (Object.keys(failure.issues).length === 0) setIssues({ form: failure.message });
      } else {
        setIssues({ form: 'Could not open the shop — check your connection and try again' });
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-5 p-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Market">
        {(['UG', 'KE'] as const).map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setCountry(code)}
            aria-pressed={code === country}
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              code === country ? 'bg-bemz-600 font-semibold text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'
            }`}
          >
            {REGIONS[code].name} — prices in {REGIONS[code].currency}
          </button>
        ))}
      </div>

      <p className="text-sm text-ink-600">
        The market sets the currency every listing shows, the VAT rate on your receipts and the
        delivery zones you can price against. It cannot be changed after the stall opens.
      </p>

      {issues.form && (
        <p role="alert" className="rounded-card border border-clay-200 bg-clay-50 px-3 py-2 text-sm text-clay-800">
          {issues.form}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Shop name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={80}
          placeholder="Nakawa Electronics"
          error={issues.name}
        />
        <TextField
          label="Store link"
          value={slug}
          onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
          maxLength={60}
          placeholder={name ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : 'leave blank to use the shop name'}
          error={issues.slug}
          leading={<span>bemz/shop/</span>}
          hint="Leave blank and we cut it from the name. Buyers see this link on every listing."
        />
      </div>

      <TextField
        label="One line buyers see under your name"
        value={tagline}
        onChange={(event) => setTagline(event.target.value)}
        maxLength={120}
        placeholder="New and used phones, repaired in Nakawa"
        error={issues.tagline}
      />

      <TextAreaField
        label="About the shop"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        rows={4}
        maxLength={2000}
        placeholder="Where you are, what you stock, how you deliver. Sellers who write this get asked fewer questions."
        error={issues.description}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <PhoneInput label="Shop phone" value={phone} onChange={setPhone} error={issues.phone} region={country} onRegionChange={setCountry} />
        <PhoneInput
          label="WhatsApp number (optional)"
          value={whatsappNumber}
          onChange={setWhatsappNumber}
          required={false}
          error={issues.whatsappNumber}
          region={country}
          onRegionChange={setCountry}
        />
      </div>

      <TextField
        label="Email (optional)"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        maxLength={160}
        autoComplete="email"
        error={issues.email}
        hint="Used for payout receipts, not for marketing."
      />

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
          label: district.zone
            ? `${district.name} — ${district.zone.name} (${district.zone.estimatedDaysMin}-${district.zone.estimatedDaysMax} days to buyers)`
            : `${district.name} — no delivery zone yet`,
          disabled: !district.zone,
        }))}
        hint="This is what a buyer is quoted for delivery time and fee before they order."
      />

      {unreachable.length > 0 && (
        <p className="rounded-card bg-ink-50 px-3 py-2 text-xs text-ink-600">
          We do not have a rider zone for {unreachable.slice(0, 6).map((district) => district.name).join(', ')}
          {unreachable.length > 6 ? ` and ${unreachable.length - 6} more` : ''} yet. Pick the nearest town you can
          actually reach, or choose to deliver yourself below.
        </p>
      )}

      {chosenDistrict?.zone && (
        <p className="text-xs text-bemz-700">
          Buyers in {chosenDistrict.name} are quoted {chosenDistrict.zone.name} rates:{' '}
          {chosenDistrict.zone.estimatedDaysMin}-{chosenDistrict.zone.estimatedDaysMax} days
          {chosenDistrict.zone.cashOnDeliveryAllowed ? ' · cash on delivery allowed' : ' · pay by mobile money or card'}
        </p>
      )}

      <TextField
        label="Street or landmark (optional)"
        value={streetAddress}
        onChange={(event) => setStreetAddress(event.target.value)}
        maxLength={160}
        placeholder="Shop 14, Nakawa modern market, near the taxi park"
        error={issues.streetAddress}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="How you deliver"
          value={defaultFulfilment}
          onChange={(event) => setDefaultFulfilment(event.target.value)}
          options={FULFILMENT}
          error={issues.defaultFulfilment}
          hint="A new listing starts with this; you can change it per listing."
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
          hint="Between 1 and 336 (two weeks). Buyers see this as your dispatch promise."
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Button type="submit" loading={busy} disabled={!name.trim() || !phone.trim() || !baseDistrictId}>
          Open the shop
        </Button>
        <p className="text-xs text-ink-500">
          Opening is free. The stall goes live once Bemz reviews it — you can list items while that is running.
        </p>
      </div>
    </form>
  );
}
