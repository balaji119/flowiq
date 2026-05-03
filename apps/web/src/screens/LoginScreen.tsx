import { useState } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { Button, Card, CardContent, Input, Label } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await login(email.trim(), password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-16">
      <Card className="relative w-full max-w-md overflow-hidden">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-orange-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              Secure Access
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white">ADS Connect</h1>
            </div>
          </div>

          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="text"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
              />
            </div>

            <Button className="w-full" size="lg" disabled={submitting} type="submit">
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin text-orange-300" /> : null}
              {submitting ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>

          <a className="inline-flex items-center gap-2 text-sm font-medium text-slate-300 transition hover:text-white" href="/forgot-password">
            Forgot your password?
          </a>

          {error ? <p className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
