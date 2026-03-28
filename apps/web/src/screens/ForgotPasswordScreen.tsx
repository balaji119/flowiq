'use client';

import { useState } from 'react';
import { ArrowLeft, LoaderCircle, Mail } from 'lucide-react';
import { Button, Card, CardContent, Input, Label } from '@flowiq/ui';
import { requestPasswordReset } from '../services/authApi';

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      const response = await requestPasswordReset(email.trim());
      setMessage(response.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to send password reset email');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.24),transparent_55%)]" />
      <Card className="relative w-full max-w-md overflow-hidden">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-violet-200">
              <Mail className="h-3.5 w-3.5" />
              Password Reset
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white">Reset your password</h1>
              <p className="text-sm leading-6 text-slate-400">
                Enter the email address for your ADS Connect account and we&apos;ll send you a reset link.
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="reset-email">Email</Label>
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </div>

            <Button className="w-full" size="lg" disabled={submitting} type="submit">
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {submitting ? 'Sending link...' : 'Send Reset Link'}
            </Button>
          </form>

          <a className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white" href="/">
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </a>

          {message ? <p className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{message}</p> : null}
          {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
