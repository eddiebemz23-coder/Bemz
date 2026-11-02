'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { CheckboxField, SelectField, TextField } from '@/components/ui/field';
import { useToast } from '@/components/toast';

interface ProfilePatch {
  name?: string;
  email?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'UNDISCLOSED';
  preferredCurrency?: 'UGX' | 'KES';
  languageCode?: 'en' | 'sw' | 'lg';
  marketingOptIn?: boolean;
  whatsappOptIn?: boolean;
}

/**
 * `PATCH /api/me`
 *
 * Only the fields the buyer can see are editable here. `preferredCurrency` is a display
 * default — a Ugandan buyer browsing a Kenyan shop still sees KES on that listing, because the
 * price belongs to the seller's market — so it is offered but explained.
 */
export function ProfileForm({
  profile,
}: {
  profile: {
    name: string | null;
    email: string | null;
    gender: string | null;
    preferredCurrency: string;
    languageCode: string;
    marketingOptIn: boolean;
    whatsappOptIn: boolean;
  };
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(profile.name ?? '');
  const [email, setEmail] = useState(profile.email ?? '');
  const [gender, setGender] = useState(profile.gender ?? 'UNDISCLOSED');
  const [currency, setCurrency] = useState(profile.preferredCurrency);
  const [language, setLanguage] = useState(profile.languageCode);
  const [marketing, setMarketing] = useState(profile.marketingOptIn);
  const [whatsapp, setWhatsapp] = useState(profile.whatsappOptIn);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssues({});

    const patch: ProfilePatch = {
      name: name.trim() || undefined,
      email: email.trim() || undefined,
      gender: gender as ProfilePatch['gender'],
      preferredCurrency: currency as ProfilePatch['preferredCurrency'],
      languageCode: language as ProfilePatch['languageCode'],
      marketingOptIn: marketing,
      whatsappOptIn: whatsapp,
    };

    try {
      await api.patch('/api/me', patch);
      toast.push('Account updated.', 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(failure.issues);
        toast.push(failure.message, 'error');
      } else {
        toast.push('Could not save your details', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="Aisha Nabukenya"
          error={issues.name}
          hint="Shown to sellers and on the delivery note the rider carries."
        />
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          maxLength={160}
          placeholder="optional@example.com"
          error={issues.email}
          hint="Optional. Receipts and disputes still go by SMS first."
        />
        <SelectField
          label="Gender"
          value={gender}
          onChange={(event) => setGender(event.target.value)}
          error={issues.gender}
          options={[
            { value: 'UNDISCLOSED', label: 'Prefer not to say' },
            { value: 'FEMALE', label: 'Female' },
            { value: 'MALE', label: 'Male' },
            { value: 'OTHER', label: 'Other' },
          ]}
          hint="Only used to report what the market buys, never to price anything."
        />
        <SelectField
          label="Language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          error={issues.languageCode}
          options={[
            { value: 'en', label: 'English' },
            { value: 'sw', label: 'Kiswahili' },
            { value: 'lg', label: 'Luganda' },
          ]}
          hint="Used for the SMS we send you — a code in Luganda is still a code."
        />
        <SelectField
          label="Preferred currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          error={issues.preferredCurrency}
          options={[
            { value: 'UGX', label: 'Uganda shilling (UGX)' },
            { value: 'KES', label: 'Kenya shilling (KES)' },
          ]}
          hint="A listing always shows the seller's own currency; this only picks which one yours are quoted in."
        />
      </div>

      <div className="space-y-2 border-t border-ink-200 pt-4">
        <CheckboxField
          label="Marketing messages"
          description="Offers from Bemz and from shops you bought from. No third parties get the number."
          checked={marketing}
          onChange={(event) => setMarketing(event.target.checked)}
        />
        <CheckboxField
          label="Order updates on WhatsApp"
          description="Dispatch and delivery messages on WhatsApp instead of SMS, where the courier supports it."
          checked={whatsapp}
          onChange={(event) => setWhatsapp(event.target.checked)}
        />
      </div>

      <Button type="submit" loading={busy}>
        Save changes
      </Button>
    </form>
  );
}
