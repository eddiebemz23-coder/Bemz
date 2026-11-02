'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFailure } from '@/lib/client/api';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { useToast } from '@/components/toast';

/**
 * `POST /api/me/password` and `DELETE /api/me/password`
 *
 * Password sign-in is optional here: an SMS code is the primary credential, because a buyer who
 * changes SIMs still owns the number and a forgotten password is a support call nobody can afford.
 * Setting the first one needs no proof (the session came from a code they just typed); changing or
 * removing one always asks for the current password, so a hijacked cookie cannot lock the owner out.
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setIssues({});
    try {
      await api.post('/api/me/password', {
        ...(current ? { currentPassword: current } : {}),
        newPassword: next,
      });
      setCurrent('');
      setNext('');
      toast.push(hasPassword ? 'Password changed.' : 'Password set — you can now sign in with your number and it.', 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(failure.issues);
        toast.push(failure.message, 'error');
      } else {
        toast.push('Could not change the password', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!current) {
      setIssues({ currentPassword: 'Enter your current password to switch back to SMS-only sign-in' });
      return;
    }
    setBusy(true);
    setIssues({});
    try {
      await api.del('/api/me/password', { currentPassword: current });
      setCurrent('');
      toast.push('Password removed. Sign in with the code sent to your number.', 'success');
      router.refresh();
    } catch (failure) {
      if (failure instanceof ApiFailure) {
        setIssues(failure.issues);
        toast.push(failure.message, 'error');
      } else {
        toast.push('Could not remove the password', 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <p className="text-sm text-ink-600">
        {hasPassword
          ? 'Your account can sign in with a password as well as an SMS code.'
          : 'Your account signs in with an SMS code only. A password is useful if several staff share this login.'}
      </p>

      {hasPassword && (
        <TextField
          label="Current password"
          type="password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          autoComplete="current-password"
          error={issues.currentPassword}
        />
      )}

      <TextField
        label={hasPassword ? 'New password' : 'Choose a password'}
        type="password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        autoComplete={hasPassword ? 'new-password' : 'new-password'}
        required
        error={issues.newPassword}
        hint="At least 8 characters, with a number and a letter."
      />

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={next.length < 8}>
          {hasPassword ? 'Change password' : 'Set password'}
        </Button>
        {hasPassword && (
          <Button type="button" variant="outline" onClick={() => void remove()} disabled={busy}>
            Remove password
          </Button>
        )}
      </div>
    </form>
  );
}
