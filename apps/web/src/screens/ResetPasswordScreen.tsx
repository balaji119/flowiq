'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, KeyRound, LoaderCircle } from 'lucide-react';
import { Button, Card, CardContent, Input, Label } from '@flowiq/ui';
import { confirmPasswordReset } from '../services/authApi';

type ResetPasswordScreenProps = {
  token: string | null;
};

export function ResetPasswordScreen({ token }: ResetPasswordScreenProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const tokenError = useMemo(() => {
    if (token && token.trim() !== '') {
      return '';
    }
    return 'This password reset link is missing a token. Request a new email and try again.';
  }, [token]);

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      if (tokenError) {
        throw new Error(tokenError);
      }
      if (password.trim().length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      if (password !== confirmPassword) {
        throw new Error('Passwords do not match');
      }

      const response = await confirmPasswordReset(token!, password);
      setMessage(response.message);
      setPassword('');
      setConfirmPassword('');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 pb-16 pt-36">
      <header className="absolute inset-x-0 top-0">
        <div className="border-b border-slate-700/80 bg-slate-900/70 backdrop-blur">
          <div className="flex min-h-[72px] items-center justify-center px-6">
            <p className="whitespace-nowrap text-sm font-bold uppercase tracking-[0.28em] text-slate-100">ADS Connect</p>
          </div>
        </div>
        <div className="border-b border-slate-700/80 bg-slate-800/85">
          <div className="flex min-h-[56px] items-center px-6">
            <p className="truncate text-lg font-semibold tracking-tight text-slate-100">Reset Password</p>
          </div>
        </div>
      </header>
      <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.24),transparent_55%)]" />
      <Card className="relative w-full max-w-md overflow-hidden">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-violet-200">
              <KeyRound className="h-3.5 w-3.5" />
              Set New Password
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white">Choose a new password</h1>
              <p className="text-sm leading-6 text-slate-400">
                Enter a new password for your ADS Connect account. This reset link can only be used once.
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Repeat your password"
              />
            </div>

            <Button className="w-full" size="lg" disabled={submitting || Boolean(tokenError)} type="submit">
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {submitting ? 'Updating password...' : 'Update Password'}
            </Button>
          </form>

          <a className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white" href="/">
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </a>

          {message ? <p className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{message}</p> : null}
          {error || tokenError ? <p className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error || tokenError}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
