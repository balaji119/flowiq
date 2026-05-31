import { useEffect, useState } from 'react';
import { CheckCircle2, LoaderCircle, ShieldCheck, ShieldOff } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { disableTwoFactor, fetchTwoFactorStatus, setupTwoFactor, TwoFactorSetupResponse, verifyTwoFactorSetup } from '../services/authApi';

export function TwoFactorSettingsCard() {
  const { refreshSession, session } = useAuth();
  const [enabled, setEnabled] = useState(Boolean(session?.user.twoFactorEnabled));
  const [setupDetails, setSetupDetails] = useState<TwoFactorSetupResponse | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        setLoading(true);
        setError('');
        const response = await fetchTwoFactorStatus();
        if (!active) return;
        setEnabled(response.enabled);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load two-factor status');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadStatus();
    return () => {
      active = false;
    };
  }, []);

  async function beginSetup() {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const response = await setupTwoFactor();
      setSetupDetails(response);
      setVerificationCode('');
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : 'Unable to start two-factor setup');
    } finally {
      setSaving(false);
    }
  }

  async function confirmSetup() {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const response = await verifyTwoFactorSetup(verificationCode);
      setEnabled(response.enabled);
      setSetupDetails(null);
      setVerificationCode('');
      setNotice('Two-factor authentication is enabled for your account.');
      await refreshSession();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Unable to verify authentication code');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisable() {
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const response = await disableTwoFactor(disableCode);
      setEnabled(response.enabled);
      setDisableCode('');
      setSetupDetails(null);
      setNotice('Two-factor authentication is disabled for your account.');
      await refreshSession();
    } catch (disableError) {
      setError(disableError instanceof Error ? disableError.message : 'Unable to disable two-factor authentication');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="p-5 pb-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Google Authenticator</CardTitle>
            <CardDescription>Protect your account with a 6-digit code from an authenticator app.</CardDescription>
          </div>
          <Badge className={enabled ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200' : undefined}>
            {enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
            <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" />
            Loading two-factor status...
          </div>
        ) : null}

        {notice ? <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-200">{notice}</div> : null}
        {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

        {!enabled && !setupDetails ? (
          <div className="flex flex-col gap-4 rounded-md border border-slate-700 bg-slate-800/60 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-violet-300" />
              <div>
                <p className="font-semibold text-white">Set up two-factor authentication</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">Scan a QR code with Google Authenticator, then verify the first code.</p>
              </div>
            </div>
            <Button disabled={saving || loading} onClick={() => void beginSetup()} type="button">
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : null}
              Start Setup
            </Button>
          </div>
        ) : null}

        {!enabled && setupDetails ? (
          <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="rounded-md border border-slate-700 bg-white p-5">
              <img alt="Google Authenticator QR code" className="mx-auto h-[220px] w-[220px]" src={setupDetails.qrCodeDataUrl} />
            </div>
            <div className="space-y-4 rounded-md border border-slate-700 bg-slate-800/60 p-4">
              <div>
                <p className="font-semibold text-white">1. Scan this QR code</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">Open Google Authenticator, add a new account, and scan the code.</p>
              </div>
              <div className="rounded-md border border-slate-700 bg-slate-950/70 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Manual setup key</p>
                <p className="mt-2 break-all font-mono text-sm text-slate-100">{setupDetails.secret}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="two-factor-setup-code">2. Enter the 6-digit code</Label>
                <Input
                  id="two-factor-setup-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  onChange={(event) => setVerificationCode(event.target.value)}
                  placeholder="123456"
                  type="text"
                  value={verificationCode}
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <Button disabled={saving || verificationCode.trim().length < 6} onClick={() => void confirmSetup()} type="button">
                  {saving ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : <CheckCircle2 className="h-4 w-4" />}
                  Verify and Enable
                </Button>
                <Button disabled={saving} onClick={() => setSetupDetails(null)} type="button" variant="ghost">
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {enabled ? (
          <div className="space-y-4 rounded-md border border-slate-700 bg-slate-800/60 p-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-300" />
              <div>
                <p className="font-semibold text-white">Two-factor authentication is active</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">You will be asked for a Google Authenticator code after entering your password.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,260px)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="two-factor-disable-code">Authenticator code</Label>
                <Input
                  id="two-factor-disable-code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  onChange={(event) => setDisableCode(event.target.value)}
                  placeholder="123456"
                  type="text"
                  value={disableCode}
                />
              </div>
              <Button disabled={saving || disableCode.trim().length < 6} onClick={() => void handleDisable()} type="button" variant="destructive">
                {saving ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : <ShieldOff className="h-4 w-4" />}
                Disable 2FA
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
