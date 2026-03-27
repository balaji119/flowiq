import { useEffect, useState } from 'react';
import { CalendarDays, FolderKanban, LayoutGrid, LoaderCircle, LogOut, Plus, Shield } from 'lucide-react';
import { CampaignListItem, createDefaultFormValues } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { createCampaign, fetchCampaigns } from '../services/campaignApi';

type CampaignLandingScreenProps = {
  onOpenCampaign: (campaignId: string) => void;
  onOpenAdmin?: () => void;
};

function formatCampaignDate(value: string) {
  if (!value) return 'TBC';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function statusStyles(status: CampaignListItem['status']) {
  if (status === 'submitted') {
    return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-200';
  }
  if (status === 'calculated') {
    return 'border-amber-400/30 bg-amber-500/10 text-amber-200';
  }
  return 'border-slate-600 bg-slate-800 text-slate-200';
}

export function CampaignLandingScreen({ onOpenCampaign, onOpenAdmin }: CampaignLandingScreenProps) {
  const { session, logout } = useAuth();
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadCampaigns() {
      try {
        setLoading(true);
        const response = await fetchCampaigns();
        if (!active) return;
        setCampaigns(response.campaigns);
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load campaign schedules');
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadCampaigns();
    return () => {
      active = false;
    };
  }, []);

  async function handleCreateCampaign() {
    setCreating(true);
    setError('');
    try {
      const response = await createCampaign({ values: createDefaultFormValues() });
      onOpenCampaign(response.campaign.id);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create campaign');
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-950/70 px-6 py-8 shadow-2xl shadow-slate-950/40">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.2),transparent_52%)]" />
        <div className="relative flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge className="w-fit gap-2 px-3 py-1 text-[11px] uppercase tracking-[0.22em]">
                <LayoutGrid className="h-3.5 w-3.5" />
                Campaign Schedules
              </Badge>
              <div className="space-y-2">
                <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl">ADS CONNECT</h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Review saved campaign schedules, reopen drafts, and start a new campaign from one landing page.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/70 p-4 text-sm text-slate-200">
              <div>
                <p className="font-semibold text-white">{session?.user.name}</p>
                <p className="text-slate-400">
                  {session?.user.role.replace('_', ' ')} • {session?.user.tenantName || 'Tenant'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {onOpenAdmin ? (
                  <Button onClick={onOpenAdmin} size="sm" variant="secondary">
                    <Shield className="h-4 w-4" />
                    Admin
                  </Button>
                ) : null}
                <Button onClick={() => void logout()} size="sm" variant="outline">
                  <LogOut className="h-4 w-4" />
                  Sign Out
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-400">{campaigns.length} campaign schedule{campaigns.length === 1 ? '' : 's'} available</div>
            <Button disabled={creating} onClick={() => void handleCreateCampaign()} size="lg">
              {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {creating ? 'Creating…' : 'Create Campaign'}
            </Button>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-[28px] border border-slate-700 bg-slate-900/90 px-6 py-20">
          <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <FolderKanban className="h-12 w-12 text-violet-300" />
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white">No campaign schedules yet</h2>
              <p className="max-w-xl text-sm leading-6 text-slate-400">
                Create your first campaign to start building a schedule, calculate totals, and submit it to PrintIQ.
              </p>
            </div>
            <Button disabled={creating} onClick={() => void handleCreateCampaign()}>
              {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create Campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((campaign) => (
            <Card key={campaign.id} className="overflow-hidden">
              <CardHeader className="space-y-4 p-6 pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <CardTitle className="text-2xl">
                      {campaign.campaignName || `Untitled Campaign ${campaign.id.slice(0, 6)}`}
                    </CardTitle>
                    <CardDescription>Updated {new Date(campaign.updatedAt).toLocaleString()}</CardDescription>
                  </div>
                  <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusStyles(campaign.status)}`}>
                    {campaign.status}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Markets</p>
                    <p className="mt-2 text-2xl font-black text-white">{campaign.marketCount}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Assets</p>
                    <p className="mt-2 text-2xl font-black text-white">{campaign.assetCount}</p>
                  </div>
                </div>

                <div className="space-y-2 text-sm text-slate-300">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-slate-400" />
                    <span>Start: {formatCampaignDate(campaign.campaignStartDate)}</span>
                  </div>
                  <p>Due: {formatCampaignDate(campaign.dueDate)}</p>
                  <p>Weeks: {campaign.numberOfWeeks || '0'}</p>
                  <p>Latest quote: {campaign.latestQuoteAmount ?? 'N/A'}</p>
                </div>

                <Button className="w-full" onClick={() => onOpenCampaign(campaign.id)}>
                  Open Campaign
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
