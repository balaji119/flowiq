import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, FolderKanban, LayoutGrid, LoaderCircle, LogOut, Pencil, Plus, Rows3, Shield, Trash2 } from 'lucide-react';
import { CampaignListItem } from '@flowiq/shared';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@flowiq/ui';
import { useAuth } from '../context/AuthContext';
import { deleteCampaign, fetchCampaigns } from '../services/campaignApi';

type CampaignLandingScreenProps = {
  onOpenCampaign: (campaignId: string | null) => void;
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
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'thumbnail' | 'table'>('table');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [campaignPendingDelete, setCampaignPendingDelete] = useState<CampaignListItem | null>(null);
  const [deletingCampaign, setDeletingCampaign] = useState(false);

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

  function handleCreateCampaign() {
    setError('');
    onOpenCampaign(null);
  }

  function openDeleteDialog(campaign: CampaignListItem) {
    if (campaign.status === 'submitted') return;
    setCampaignPendingDelete(campaign);
    setDeleteDialogOpen(true);
  }

  async function handleConfirmDeleteCampaign() {
    if (!campaignPendingDelete) return;
    setDeletingCampaign(true);
    setError('');
    try {
      await deleteCampaign(campaignPendingDelete.id);
      setCampaigns((current) => current.filter((item) => item.id !== campaignPendingDelete.id));
      setDeleteDialogOpen(false);
      setCampaignPendingDelete(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to delete campaign');
    } finally {
      setDeletingCampaign(false);
    }
  }

  const filteredCampaigns = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return campaigns;
    return campaigns.filter((campaign) => {
      const campaignName = (campaign.campaignName || '').toLowerCase();
      return campaignName.includes(query);
    });
  }, [campaigns, searchQuery]);

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

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="text-sm text-slate-400">
              {filteredCampaigns.length} of {campaigns.length} campaign schedule{campaigns.length === 1 ? '' : 's'}
            </div>
            <div className="flex w-full flex-col gap-3 sm:flex-row lg:w-auto">
              <input
                className="h-11 rounded-xl border border-slate-600 bg-slate-800 px-3 text-sm text-slate-50 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/70 sm:min-w-[260px]"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search campaign name"
                type="text"
                value={searchQuery}
              />
              <div className="flex rounded-xl border border-slate-700 bg-slate-900/70 p-1">
                <Button
                  aria-label="Thumbnail view"
                  className={`h-9 w-9 rounded-lg border border-transparent px-0 transition-colors focus-visible:ring-0 ${
                    viewMode === 'thumbnail'
                      ? 'border border-violet-400/60 bg-violet-500/20 text-violet-100 hover:bg-violet-500/25'
                      : 'bg-transparent text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                  onClick={() => setViewMode('thumbnail')}
                  type="button"
                  variant="ghost"
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
                <Button
                  aria-label="Table view"
                  className={`h-9 w-9 rounded-lg border border-transparent px-0 transition-colors focus-visible:ring-0 ${
                    viewMode === 'table'
                      ? 'border border-violet-400/60 bg-violet-500/20 text-violet-100 hover:bg-violet-500/25'
                      : 'bg-transparent text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`}
                  onClick={() => setViewMode('table')}
                  type="button"
                  variant="ghost"
                >
                  <Rows3 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button onClick={handleCreateCampaign} size="lg">
              <Plus className="h-4 w-4" />
              Create Campaign
            </Button>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-[28px] border border-slate-700 bg-slate-900/90 px-6 py-20">
          <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <FolderKanban className="h-12 w-12 text-violet-300" />
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white">{campaigns.length === 0 ? 'No campaign schedules yet' : 'No matching campaigns'}</h2>
              <p className="max-w-xl text-sm leading-6 text-slate-400">
                {campaigns.length === 0
                  ? 'Create your first campaign to start building a schedule, calculate totals, and submit it to PrintIQ.'
                  : 'Try a different campaign name in search.'}
              </p>
            </div>
            <Button onClick={handleCreateCampaign}>
              <Plus className="h-4 w-4" />
              Create Campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {viewMode === 'thumbnail' ? (
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredCampaigns.map((campaign) => (
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

                    <div className="flex justify-end gap-2">
                      <Button
                        aria-label="Edit campaign"
                        className="h-7 w-7 rounded-md border-0 p-0 hover:bg-slate-700/70"
                        onClick={() => onOpenCampaign(campaign.id)}
                        type="button"
                        variant="ghost"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        aria-label="Delete campaign"
                        className={campaign.status === 'submitted'
                          ? 'h-7 w-7 rounded-md border-0 p-0 text-slate-600 opacity-60 cursor-not-allowed'
                          : 'h-7 w-7 rounded-md border-0 p-0 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200'}
                        disabled={campaign.status === 'submitted'}
                        onClick={() => openDeleteDialog(campaign)}
                        title={campaign.status === 'submitted' ? 'Submitted campaigns cannot be deleted' : 'Delete campaign'}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>
          ) : (
            <section className="overflow-x-auto rounded-[24px] border border-slate-700 bg-slate-900/60">
              <table className="min-w-[1080px] w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                    <th className="border border-slate-700 px-4 py-3 text-left">Campaign</th>
                    <th className="border border-slate-700 px-4 py-3 text-left">Status</th>
                    <th className="border border-slate-700 px-4 py-3 text-left">Updated</th>
                    <th className="border border-slate-700 px-4 py-3 text-center">Markets</th>
                    <th className="border border-slate-700 px-4 py-3 text-center">Assets</th>
                    <th className="border border-slate-700 px-4 py-3 text-left">Start</th>
                    <th className="border border-slate-700 px-4 py-3 text-left">Due</th>
                    <th className="border border-slate-700 px-4 py-3 text-center">Weeks</th>
                    <th className="border border-slate-700 px-4 py-3 text-center">Latest Quote</th>
                    <th className="border border-slate-700 px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((campaign) => (
                    <tr key={`campaign-table-${campaign.id}`} className="bg-slate-800/70 border-t border-slate-700/70">
                      <td className="border border-slate-700 px-4 py-3 font-semibold text-white">
                        {campaign.campaignName || `Untitled Campaign ${campaign.id.slice(0, 6)}`}
                      </td>
                      <td className="border border-slate-700 px-4 py-3">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${statusStyles(campaign.status)}`}>
                          {campaign.status}
                        </span>
                      </td>
                      <td className="border border-slate-700 px-4 py-3 text-slate-300">{new Date(campaign.updatedAt).toLocaleString()}</td>
                      <td className="border border-slate-700 px-4 py-3 text-center font-semibold text-white">{campaign.marketCount}</td>
                      <td className="border border-slate-700 px-4 py-3 text-center font-semibold text-white">{campaign.assetCount}</td>
                      <td className="border border-slate-700 px-4 py-3 text-slate-300">{formatCampaignDate(campaign.campaignStartDate)}</td>
                      <td className="border border-slate-700 px-4 py-3 text-slate-300">{formatCampaignDate(campaign.dueDate)}</td>
                      <td className="border border-slate-700 px-4 py-3 text-center text-slate-300">{campaign.numberOfWeeks || '0'}</td>
                      <td className="border border-slate-700 px-4 py-3 text-center text-slate-300">{campaign.latestQuoteAmount ?? 'N/A'}</td>
                      <td className="border border-slate-700 px-4 py-3">
                        <div className="flex justify-center gap-2">
                          <Button
                            aria-label="Edit campaign"
                            className="h-7 w-7 rounded-md border-0 p-0 hover:bg-slate-700/70"
                            onClick={() => onOpenCampaign(campaign.id)}
                            type="button"
                            variant="ghost"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label="Delete campaign"
                            className={campaign.status === 'submitted'
                              ? 'h-7 w-7 rounded-md border-0 p-0 text-slate-600 opacity-60 cursor-not-allowed'
                              : 'h-7 w-7 rounded-md border-0 p-0 text-rose-300 hover:bg-rose-500/15 hover:text-rose-200'}
                            disabled={campaign.status === 'submitted'}
                            onClick={() => openDeleteDialog(campaign)}
                            title={campaign.status === 'submitted' ? 'Submitted campaigns cannot be deleted' : 'Delete campaign'}
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (deletingCampaign) return;
          setDeleteDialogOpen(open);
          if (!open) setCampaignPendingDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader className="pb-2">
            <DialogTitle>Delete Campaign</DialogTitle>
            <DialogDescription className="pt-1 leading-6">
              {campaignPendingDelete
                ? `Delete "${campaignPendingDelete.campaignName || `Untitled Campaign ${campaignPendingDelete.id.slice(0, 6)}`}"? This action cannot be undone.`
                : 'Delete this campaign? This action cannot be undone.'}
            </DialogDescription>
          </DialogHeader>
          <div className="pt-2">
            <div className="flex justify-end gap-3">
              <Button
                disabled={deletingCampaign}
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setCampaignPendingDelete(null);
                }}
                type="button"
                variant="ghost"
              >
                Cancel
              </Button>
              <Button disabled={deletingCampaign} onClick={() => void handleConfirmDeleteCampaign()}>
                {deletingCampaign ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {deletingCampaign ? 'Deleting...' : 'Delete Campaign'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
