import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, FolderKanban, LayoutGrid, LoaderCircle, Pencil, Plus, Rows3, Search, Trash2 } from 'lucide-react';
import { CampaignListItem } from '@flowiq/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@flowiq/ui';
import { createPortal } from 'react-dom';
import { fetchActiveUsersCount } from '../services/authApi';
import { acquireCampaignEditLock, deleteCampaign, fetchCampaigns } from '../services/campaignApi';

type CampaignLandingScreenProps = {
  onOpenCampaign: (campaignId: string | null) => void;
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

export function CampaignLandingScreen({ onOpenCampaign }: CampaignLandingScreenProps) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'thumbnail' | 'table'>('table');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [campaignPendingDelete, setCampaignPendingDelete] = useState<CampaignListItem | null>(null);
  const [deletingCampaign, setDeletingCampaign] = useState(false);
  const [activeUsersCount, setActiveUsersCount] = useState<number | null>(1);
  const [topBarCenterHost, setTopBarCenterHost] = useState<HTMLElement | null>(null);
  const [topBarActionsHost, setTopBarActionsHost] = useState<HTMLElement | null>(null);

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

  useEffect(() => {
    setTopBarCenterHost(document.getElementById('workspace-topbar-center-slot'));
    setTopBarActionsHost(document.getElementById('workspace-topbar-actions-slot'));
  }, []);

  useEffect(() => {
    let active = true;

    async function loadActiveUsers() {
      try {
        const response = await fetchActiveUsersCount();
        if (!active) return;
        setActiveUsersCount(Math.max(1, response.activeUsers || 0));
      } catch {
        if (!active) return;
        setActiveUsersCount(1);
      }
    }

    void loadActiveUsers();
    const intervalId = window.setInterval(() => {
      void loadActiveUsers();
    }, 60000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  function handleCreateCampaign() {
    setError('');
    onOpenCampaign(null);
  }

  async function handleOpenCampaign(campaignId: string) {
    setError('');
    try {
      await acquireCampaignEditLock(campaignId);
      onOpenCampaign(campaignId);
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : 'Unable to open campaign for editing');
    }
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

  const topBarActions = (
    <div className="flex flex-wrap items-center justify-end gap-4">
      <p className="hidden whitespace-nowrap text-[11px] text-slate-400 lg:block">
        Active users <span className="font-semibold text-slate-200">{activeUsersCount ?? '--'}</span>
      </p>
      <div className="flex h-10 min-w-[248px] overflow-hidden rounded-lg border border-white/10 bg-slate-900/60 transition-[background-color,border-color,box-shadow] duration-200 hover:border-white/15 hover:bg-slate-900/70 focus-within:border-orange-300/45 focus-within:shadow-[0_0_0_1px_rgba(251,146,60,0.22)]">
        <span className="inline-flex items-center gap-2 border-r border-slate-600 px-3 text-xs font-semibold text-slate-300">
          Campaign
          <Search className="h-3.5 w-3.5 text-slate-400" />
        </span>
        <input
          className="h-full w-full bg-transparent px-3 text-sm text-slate-50 placeholder:text-slate-500 focus-visible:outline-none"
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search..."
          type="text"
          value={searchQuery}
        />
      </div>
      <div className="flex h-10 items-center rounded-lg border border-white/10 bg-slate-900/70 p-1 transition-[background-color,border-color,box-shadow] duration-200 hover:border-white/15">
        <Button
          aria-label="Thumbnail view"
          className={`h-8 w-8 rounded-md border border-transparent px-0 transition-[background-color,border-color,color,transform] duration-200 ease-out focus-visible:ring-0 ${
            viewMode === 'thumbnail'
              ? 'border border-orange-400/60 bg-orange-500/20 text-orange-100 hover:bg-orange-500/25'
              : 'bg-transparent text-slate-300 hover:-translate-y-[1px] hover:bg-slate-800/70 hover:text-white'
          }`}
          onClick={() => setViewMode('thumbnail')}
          type="button"
          variant="ghost"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>
        <Button
          aria-label="Table view"
          className={`h-8 w-8 rounded-md border border-transparent px-0 transition-[background-color,border-color,color,transform] duration-200 ease-out focus-visible:ring-0 ${
            viewMode === 'table'
              ? 'border border-orange-400/60 bg-orange-500/20 text-orange-100 hover:bg-orange-500/25'
              : 'bg-transparent text-slate-300 hover:-translate-y-[1px] hover:bg-slate-800/70 hover:text-white'
          }`}
          onClick={() => setViewMode('table')}
          type="button"
          variant="ghost"
        >
          <Rows3 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Button
        className="h-10 rounded-xl border border-orange-300/35 bg-orange-600 px-[18px] text-sm font-semibold text-white shadow-[0_2px_10px_rgba(234,88,12,0.22)] transition-[background-color,border-color,transform,box-shadow,filter] duration-200 ease-out hover:-translate-y-[1px] hover:brightness-[1.04] hover:bg-orange-500 hover:shadow-[0_10px_22px_rgba(249,115,22,0.26)]"
        onClick={handleCreateCampaign}
      >
        <Plus className="h-4 w-4" />
        Create Campaign
      </Button>
    </div>
  );

  return (
    <main className="dense-main flex min-h-0 w-full flex-col gap-6">
      {topBarCenterHost ? createPortal(<span aria-hidden="true" />, topBarCenterHost) : null}
      {topBarActionsHost ? createPortal(topBarActions, topBarActionsHost) : null}

      {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 px-6 py-20">
          <LoaderCircle className="h-6 w-6 animate-spin text-orange-300" />
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <Card className="border-white/10 bg-[#162033]">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <FolderKanban className="h-12 w-12 text-orange-300" />
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white">{campaigns.length === 0 ? 'No campaign schedules yet' : 'No matching campaigns'}</h2>
              <p className="max-w-xl text-sm leading-6 text-slate-400">
                {campaigns.length === 0
                  ? 'Create your first campaign to start building a schedule, calculate totals, and submit it to PrintIQ.'
                  : 'Try a different campaign name in search.'}
              </p>
            </div>
            <Button className="h-10 rounded-xl border border-orange-300/35 bg-orange-600 px-[18px] text-sm font-semibold text-white shadow-[0_2px_10px_rgba(234,88,12,0.22)] transition-[background-color,border-color,transform,box-shadow,filter] duration-200 ease-out hover:-translate-y-[1px] hover:brightness-[1.04] hover:bg-orange-500 hover:shadow-[0_10px_22px_rgba(249,115,22,0.26)]" onClick={handleCreateCampaign}>
              <Plus className="h-4 w-4" />
              Create Campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {viewMode === 'thumbnail' ? (
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredCampaigns.map((campaign) => (
                <Card key={campaign.id} className="overflow-hidden">
                  <CardHeader className="space-y-3 p-4 pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1.5">
                        <CardTitle className="text-xl leading-tight">
                          <button
                            className="w-full whitespace-normal break-words text-left text-white transition hover:text-orange-200"
                            onClick={() => void handleOpenCampaign(campaign.id)}
                            title="Open campaign for editing"
                            type="button"
                          >
                            {campaign.campaignName || `Untitled Campaign ${campaign.id.slice(0, 6)}`}
                          </button>
                        </CardTitle>
                        <CardDescription className="text-xs">Updated {new Date(campaign.updatedAt).toLocaleString()}</CardDescription>
                      </div>
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${statusStyles(campaign.status)}`}>
                        {campaign.status}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="rounded-md border border-slate-700 bg-slate-900/70 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Markets</p>
                        <p className="mt-1 text-xl font-black text-white">{campaign.marketCount}</p>
                      </div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/70 p-3">
                        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Assets</p>
                        <p className="mt-1 text-xl font-black text-white">{campaign.assetCount}</p>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-sm text-slate-300">
                      <div className="flex items-center gap-1.5">
                        <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
                        <span>Start: {formatCampaignDate(campaign.campaignStartDate)}</span>
                      </div>
                      <p>Due: {formatCampaignDate(campaign.dueDate)}</p>
                      <p>Weeks: {campaign.numberOfWeeks || '0'}</p>
                      <p>Latest quote: {campaign.latestQuoteAmount ?? 'N/A'}</p>
                    </div>

                    <div className="flex justify-end gap-1.5 pt-1">
                        <Button
                          aria-label="Edit campaign"
                          className="h-7 w-7 rounded-md border-0 p-0 hover:bg-slate-700/70"
                          onClick={() => void handleOpenCampaign(campaign.id)}
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
            <section className="overflow-x-auto rounded-md border border-white/10 bg-[#162033] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
              <table className="dense-table min-w-[980px] w-full border-collapse text-[14px]">
                <thead>
                  <tr className="bg-slate-950/65 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-200">
                    <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Campaign</th>
                    <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Created By</th>
                    <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Updated</th>
                    <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-center backdrop-blur">Markets</th>
                    <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-center backdrop-blur">Assets</th>
                    <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Start</th>
                    <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Due</th>
                    <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-center backdrop-blur">Weeks</th>
                    <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-center backdrop-blur">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((campaign, rowIndex) => (
                    <tr
                      key={`campaign-table-${campaign.id}`}
                      className={`border-t border-white/5 align-middle transition-[background-color,border-color] duration-200 ${
                        rowIndex % 2 === 0 ? 'bg-[#1a2740]/70' : 'bg-[#162033]'
                      } hover:bg-[#1d2a40]`}
                    >
                      <td className="px-5 py-2.5 font-semibold text-white">
                        <button
                          className="block max-w-[320px] truncate whitespace-nowrap text-left text-white transition hover:text-orange-200"
                          onClick={() => void handleOpenCampaign(campaign.id)}
                          title={campaign.campaignName || `Untitled Campaign ${campaign.id.slice(0, 6)}`}
                          type="button"
                        >
                          {campaign.campaignName || `Untitled Campaign ${campaign.id.slice(0, 6)}`}
                        </button>
                      </td>
                      <td className="px-5 py-2.5 text-slate-300">{campaign.createdBy || 'N/A'}</td>
                      <td className="px-5 py-2.5 text-slate-300">{new Date(campaign.updatedAt).toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-center font-semibold text-white">{campaign.marketCount}</td>
                      <td className="px-5 py-2.5 text-center font-semibold text-white">{campaign.assetCount}</td>
                      <td className="px-5 py-2.5 text-slate-300">{formatCampaignDate(campaign.campaignStartDate)}</td>
                      <td className="px-5 py-2.5 text-slate-300">{formatCampaignDate(campaign.dueDate)}</td>
                      <td className="px-5 py-2.5 text-center text-slate-300">{campaign.numberOfWeeks || '0'}</td>
                      <td className="px-5 py-2.5">
                        <div className="flex justify-center gap-2">
                          <Button
                            aria-label="Edit campaign"
                            className="h-8 w-8 rounded-md border border-white/10 p-0 text-slate-200 transition-[background-color,border-color,color,transform,box-shadow] duration-200 hover:-translate-y-[1px] hover:border-white/20 hover:bg-slate-700/70 hover:text-white hover:shadow-[0_6px_14px_rgba(15,23,42,0.26)]"
                            onClick={() => void handleOpenCampaign(campaign.id)}
                            type="button"
                            variant="ghost"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            aria-label="Delete campaign"
                            className={campaign.status === 'submitted'
                              ? 'h-8 w-8 cursor-not-allowed rounded-md border border-white/10 p-0 text-slate-600 opacity-60'
                              : 'h-8 w-8 rounded-md border border-white/10 p-0 text-rose-300 transition-[background-color,border-color,color,transform,box-shadow] duration-200 hover:-translate-y-[1px] hover:border-rose-300/35 hover:bg-rose-500/15 hover:text-rose-200 hover:shadow-[0_6px_14px_rgba(244,63,94,0.14)]'}
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
                {deletingCampaign ? <LoaderCircle className="h-4 w-4 animate-spin text-orange-300" /> : <Trash2 className="h-4 w-4" />}
                {deletingCampaign ? 'Deleting...' : 'Delete Campaign'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
