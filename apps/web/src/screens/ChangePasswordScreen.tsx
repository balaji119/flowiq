'use client';

import { useState } from 'react';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { Button, Card, CardContent, Input, Label } from '@flowiq/ui';
import { changePassword } from '../services/authApi';

export function ChangePasswordScreen() {
  const [email, setEmail] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    setSubmitting(true);
    setMessage('');
    setError('');

    try {
      if (newPassword.trim().length < 8) {
        throw new Error('New password must be at least 8 characters');
      }
      if (newPassword !== confirmNewPassword) {
        throw new Error('New passwords do not match');
      }
      const response = await changePassword(email.trim(), oldPassword, newPassword);
      setMessage(response.message);
      setOldPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Unable to change password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,rgba(105, 53, 228,0.24),transparent_55%)]" />
      <Card className="relative w-full max-w-md overflow-hidden">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-3">
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white">Change password</h1>
              <p className="text-sm leading-6 text-slate-400">
                Enter your email, old password, and new password to update your account.
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="change-password-email">Email</Label>
              <Input
                id="change-password-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="change-password-old">Old password</Label>
              <Input
                id="change-password-old"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                placeholder="Enter old password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="change-password-new">New password</Label>
              <Input
                id="change-password-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="change-password-confirm">Repeat new password</Label>
              <Input
                id="change-password-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmNewPassword}
                onChange={(event) => setConfirmNewPassword(event.target.value)}
                placeholder="Repeat new password"
              />
            </div>

            <Button className="w-full" variant="default" size="lg" disabled={submitting} type="submit">
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : null}
              {submitting ? 'Changing password...' : 'Change Password'}
            </Button>
          </form>

          <a className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white" href="/">
            <ArrowLeft className="h-4 w-4" />
            Back to sign in
          </a>

          {message ? <p className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{message}</p> : null}
          {error ? <p className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
