'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { api, ApiFailure } from '@/lib/client/api';
import { useCart } from '@/lib/client/cart-store';
import { PhoneInput } from '@/components/auth/phone-input';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { cn } from '@/lib/cn';

type Mode = 'code' | 'password';

interface OtpTicket {
  e164: string;
  expiresInSeconds: number;
  cooldownSeconds: number;
  devCode?: string;
  message: string;
}

/**
 * Two doors, one session. The code path is what the market uses; the password path exists for
 * admin staff and for shops that insist on one — see `src/lib/auth/options.ts`.
 */
export function LoginForm({ callbackUrl = '/' }: { callbackUrl?: string }) {
  const router = useRouter();
  const { mergeAfterSignIn, count } = useCart();

  const [mode, setMode] = useState<Mode>('code');
  const [region, setRegion] = useState<'UG' | 'KE'>('UG');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<OtpTicket | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const result = await api.post<OtpTicket>('/api/auth/otp/request', {
        phone,
        purpose: 'LOGIN',
        defaultRegion: region,
      });
      setTicket(result);
      setSecondsLeft(result.cooldownSeconds);
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  }

  async function finishSignIn(provider: 'phone-otp' | 'password', credentials: Record<string, string>) {
    setBusy(true);
    setError(null);
    const result = await signIn(provider, { ...credentials, redirect: false });
    setBusy(false);

    if (!result || result.error) {
      setError(
        result?.error === 'CredentialsSignin'
          ? 'That code or password did not match. Check the number and try again.'
          : 'Sign-in failed. Try again, or request a new code.',
      );
      return;
    }

    // A basket filled while browsing as a guest must survive the login that follows it.
    if (count > 0) await mergeAfterSignIn();
    router.replace(callbackUrl);
    router.refresh();
  }

  return (
    <div className="card mx-auto w-full max-w-md p-6">
      <h1 className="text-xl font-bold text-ink-900">Sign in to Bemz</h1>
      <p className="mt-1 text-sm text-ink-500">
        No account yet? A code on your phone creates one for you.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg bg-ink-100 p-1">
        {(['code', 'password'] as Mode[]).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              setMode(option);
              setError(null);
            }}
            className={cn(
              'rounded-md py-2 text-sm font-medium transition-colors',
              mode === option ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600',
            )}
          >
            {option === 'code' ? 'Code by SMS' : 'Password'}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-clay-50 px-3 py-2 text-sm text-clay-800">
          {error}
        </p>
      )}

      {mode === 'code' ? (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void finishSignIn('phone-otp', { phone, code });
          }}
        >
          <PhoneInput value={phone} onChange={setPhone} region={region} onRegionChange={setRegion} disabled={Boolean(ticket)} />

          {!ticket ? (
            <Button block size="lg" loading={busy} disabled={phone.trim().length < 9} onClick={sendCode} type="button">
              Send me a code
            </Button>
          ) : (
            <>
              <p className="text-sm text-ink-600">{ticket.message}</p>
              <TextField
                label="6-digit code"
                name="code"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="000000"
                hint={
                  ticket.devCode
                    ? `Development mode — the code is ${ticket.devCode}. It expires in ${Math.round(ticket.expiresInSeconds / 60)} min.`
                    : `Sent to ${ticket.e164}`
                }
              />

              <div className="flex items-center gap-3">
                <Button block size="lg" type="submit" loading={busy} disabled={code.length !== 6}>
                  Sign in
                </Button>
                <Button variant="ghost" size="lg" type="button" disabled={secondsLeft > 0 || busy} onClick={sendCode}>
                  {secondsLeft > 0 ? `${secondsLeft}s` : 'Resend'}
                </Button>
              </div>

              <button type="button" onClick={() => { setTicket(null); setCode(''); }} className="text-sm text-bemz-700 underline">
                Use a different number
              </button>
            </>
          )}
        </form>
      ) : (
        <form
          className="mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void finishSignIn('password', { identifier, password });
          }}
        >
          <TextField
            label="Phone or email"
            name="identifier"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            autoComplete="username"
            required
          />
          <TextField
            label="Password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <Button block size="lg" type="submit" loading={busy}>
            Sign in
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-ink-500">
        New here?{' '}
        <Link href="/register" className="font-medium text-bemz-700 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
