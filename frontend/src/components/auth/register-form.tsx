'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { api, ApiFailure } from '@/lib/client/api';
import { useCart } from '@/lib/client/cart-store';
import { PhoneInput } from '@/components/auth/phone-input';
import { Button } from '@/components/ui/button';
import { CheckboxField, SwitchField, TextField } from '@/components/ui/field';
import { REGIONS, type RegionInfo } from '@/lib/client/regions';

type Region = 'UG' | 'KE';

interface RegisterResponse {
  user: { id: string; name: string | null; phone: string; role: string };
  shop: { id: string; name: string; slug: string } | null;
  hasPassword: boolean;
  cartMerged: boolean;
}

/**
 * Registration is one form for both doors: a buyer who wants a password and a trader who wants
 * a shop in the same request. The shop row lands as PENDING because the district, KYC and payout
 * details are filled in on the dashboard — see `createShopShell` in `src/lib/services/accounts.ts`.
 */
export function RegisterForm({ initialSeller = false, callbackUrl = '/' }: { initialSeller?: boolean; callbackUrl?: string }) {
  const router = useRouter();
  const { mergeAfterSignIn, count } = useCart();

  const [region, setRegion] = useState<Region>('UG');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [asSeller, setAsSeller] = useState(initialSeller);
  const [shopName, setShopName] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);

  const [issues, setIssues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [signedUpPhone, setSignedUpPhone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function rememberRegion(next: Region) {
    setRegion(next);
    // The country select and the dialling prefix are the same fact; keep them in step.
    setIssues((current) => ({ ...current, country: '', phone: '' }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setIssues({});
    setBusy(true);
    try {
      const result = await api.post<RegisterResponse>('/api/auth/register', {
        name,
        phone,
        email: email.trim() || undefined,
        password: password || undefined,
        country: region,
        asSeller,
        shopName: asSeller ? shopName : undefined,
        acceptTerms: true,
      });

      if (result.hasPassword) {
        // The password door proves nothing about the SIM, so the session starts here and the
        // number stays unverified until the next OTP login.
        const signInResult = await signIn('password', {
          identifier: result.user.phone,
          password,
          redirect: false,
        });
        if (!signInResult?.error) {
          if (count > 0) await mergeAfterSignIn();
          router.replace(asSeller && result.shop ? '/seller' : callbackUrl);
          router.refresh();
          return;
        }
        setSignedUpPhone(result.user.phone);
        return;
      }

      setSignedUpPhone(result.user.phone);
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(failure.issues);
        setFormError(failure.message);
      } else {
        setFormError('Could not create the account. Check your connection and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (signedUpPhone) {
    return (
      <div className="card mx-auto w-full max-w-md p-6">
        <h1 className="text-xl font-bold text-ink-900">Account created</h1>
        <p className="mt-2 text-sm text-ink-600">
          {asSeller
            ? 'Your shop is open for business in draft. Verify the number, then add your first listing.'
            : 'Verify the number on your phone to start buying.'}
        </p>
        <p className="mt-3 text-sm text-ink-500">
          Sign in with a code sent to <span className="font-medium text-ink-800">{signedUpPhone}</span>.
        </p>
        <Button
          className="mt-5"
          block
          size="lg"
          onClick={() => router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)}
        >
          Get my code and sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="card mx-auto w-full max-w-lg p-6">
      <h1 className="text-xl font-bold text-ink-900">Create your Bemz account</h1>
      <p className="mt-1 text-sm text-ink-500">
        A phone number is enough. Passwords are optional, and you can always sign in with a code.
      </p>

      {formError && (
        <p role="alert" className="mt-4 rounded-lg bg-clay-50 px-3 py-2 text-sm text-clay-800">
          {formError}
        </p>
      )}

      <form className="mt-5 space-y-4" onSubmit={submit}>
        <TextField
          label="Full name"
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          placeholder="Sarah Nakato"
          error={issues.name}
          required
        />

        <PhoneInput
          value={phone}
          onChange={setPhone}
          region={region}
          onRegionChange={rememberRegion}
          error={issues.phone}
          label="Phone number"
          autoComplete="tel"
          required
        />

        <div>
          <label className="field-label" htmlFor="register-country">
            Country
          </label>
          <select
            id="register-country"
            className="field-input"
            value={region}
            onChange={(event) => rememberRegion(event.target.value as Region)}
          >
            {(Object.values(REGIONS) as RegionInfo[]).map((option) => (
              <option key={option.code} value={option.code}>
                {option.name} — prices in {option.currency}
              </option>
            ))}
          </select>
          {issues.country && <p className="mt-1 text-sm text-clay-700">{issues.country}</p>}
        </div>

        <TextField
          label="Email (optional)"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          error={issues.email}
          hint="Only used for receipts if you add it."
        />

        <TextField
          label="Password (optional)"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          error={issues.password}
          hint="At least 8 characters with one number. Leave blank to sign in by code only."
        />

        <div className="rounded-card border border-ink-200 p-4">
          <SwitchField
            label="Register as a seller"
            description="Open a shop and list products. You can do this later too."
            checked={asSeller}
            onChange={setAsSeller}
          />
          {asSeller && (
            <div className="mt-4">
              <TextField
                label="Shop name"
                name="shopName"
                value={shopName}
                onChange={(event) => setShopName(event.target.value)}
                placeholder="Nakato Fresh Produce"
                error={issues.shopName}
                hint="Buyers see this on every listing. You can rename it later."
                required
              />
            </div>
          )}
        </div>

        <CheckboxField
          label="I accept the buyer and seller terms"
          description="Includes the delivery, returns and commission rules for your country."
          checked={acceptTerms}
          onChange={(event) => setAcceptTerms(event.target.checked)}
        />
        {issues.acceptTerms && <p className="text-sm text-clay-700">{issues.acceptTerms}</p>}

        <Button block size="lg" type="submit" loading={busy} disabled={!acceptTerms}>
          {asSeller ? 'Create account and shop' : 'Create account'}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm text-ink-500">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-bemz-700 hover:underline">
          Sign in with a code
        </Link>
      </p>
    </div>
  );
}
