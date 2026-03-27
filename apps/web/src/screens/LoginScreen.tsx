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
      <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,rgba(139,92,246,0.24),transparent_55%)]" />
      <Card className="relative w-full max-w-md overflow-hidden">
        <CardContent className="space-y-6 p-8">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-500/10 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-violet-200">
              <ShieldCheck className="h-3.5 w-3.5" />
              Secure Access
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-black tracking-tight text-white">Sign in to ADS CONNECT</h1>
              <p className="text-sm leading-6 text-slate-400">
                Access the campaign scheduling and PrintIQ workflow from a single browser workspace.
              </p>
            </div>
          </div>

          <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="email">Email or username</Label>
              <Input
                id="email"
                type="text"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com or admin"
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
              {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {submitting ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>

          {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
