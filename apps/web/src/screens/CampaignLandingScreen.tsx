import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Eye, FolderKanban, LoaderCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { CampaignListItem, CampaignRecord } from '@flowiq/shared';
import { Button, Card, CardContent, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@flowiq/ui';
import { acquireCampaignEditLock, calculatePersistedCampaign, deleteCampaign, fetchCampaign, fetchCampaigns } from '../services/campaignApi';
import { CampaignScheduleViewDialog } from './CampaignScheduleViewDialog';

type CampaignLandingScreenProps = {
  onOpenCampaign: (campaignId: string | null) => void;
  showHero?: boolean;
};

function formatCampaignDate(value: string) {
  if (!value) return 'TBC';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function WorkflowIllustration() {
  return (
    <div className="relative h-[280px] w-full overflow-hidden rounded-2xl border border-white/10 bg-[#110f24]/92 p-4 backdrop-blur-xl sm:h-[300px] lg:h-[336px] xl:h-[360px]">
      <div className="absolute -left-14 -top-12 h-44 w-44 rounded-full bg-violet-500/14 blur-3xl" />
      <div className="absolute -right-14 bottom-0 h-52 w-52 rounded-full bg-violet-400/12 blur-3xl" />
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(rgba(148,163,184,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.3) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
      <svg className="relative h-full w-full" fill="none" viewBox="0 0 620 320" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="nodeFill" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#1e163c" />
            <stop offset="100%" stopColor="#161231" />
          </linearGradient>
          <linearGradient id="flowLine" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--primary-500)" stopOpacity="0.72" />
          </linearGradient>
        </defs>

        <rect fill="url(#nodeFill)" height="78" rx="14" stroke="rgba(255,255,255,0.14)" width="138" x="24" y="34" />
        <text fill="#F9FAFB" fontFamily="Inter, Geist, sans-serif" fontSize="14" fontWeight="600" x="40" y="62">Asset Plan</text>
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="11" x="40" y="84">Billboard nodes</text>
        <circle cx="132" cy="52" fill="var(--primary-500)" fillOpacity="0.32" r="8" />

        <rect fill="url(#nodeFill)" height="78" rx="14" stroke="rgba(255,255,255,0.14)" width="138" x="236" y="116" />
        <text fill="#F9FAFB" fontFamily="Inter, Geist, sans-serif" fontSize="14" fontWeight="600" x="252" y="144">Schedule</text>
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="11" x="252" y="166">Week allocations</text>
        <circle cx="342" cy="134" fill="#38BDF8" fillOpacity="0.32" r="8" />

        <rect fill="url(#nodeFill)" height="78" rx="14" stroke="rgba(255,255,255,0.14)" width="162" x="434" y="198" />
        <text fill="#F9FAFB" fontFamily="Inter, Geist, sans-serif" fontSize="14" fontWeight="600" x="452" y="226">ADS Output</text>
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="11" x="452" y="248">Quote-ready export</text>
        <circle cx="564" cy="216" fill="var(--primary-500)" fillOpacity="0.36" r="8" />

        <path d="M162 74 C214 74, 206 124, 236 134" stroke="url(#flowLine)" strokeWidth="2.4" />
        <path d="M374 156 C426 168, 430 214, 434 224" stroke="url(#flowLine)" strokeWidth="2.4" />

        <circle cx="90" cy="212" fill="#161231" r="46" stroke="rgba(255,255,255,0.1)" />
        <path d="M66 212 L90 188 L114 212 L90 236 Z" stroke="#38BDF8" strokeOpacity="0.75" strokeWidth="1.6" />
        <circle cx="90" cy="212" fill="var(--primary-500)" fillOpacity="0.18" r="12" />
        <text fill="#9CA3AF" fontFamily="Inter, Geist, sans-serif" fontSize="10" x="52" y="272">Market map</text>
      </svg>
    </div>
  );
}

export function CampaignLandingScreen({ onOpenCampaign, showHero = false }: CampaignLandingScreenProps) {
  const [campaigns, setCampaigns] = useState<CampaignListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [campaignPendingDelete, setCampaignPendingDelete] = useState<CampaignListItem | null>(null);
  const [deletingCampaign, setDeletingCampaign] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState('');
  const [campaignForView, setCampaignForView] = useState<CampaignRecord | null>(null);
  const [viewCampaignId, setViewCampaignId] = useState<string | null>(null);

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

  async function handleOpenCampaign(campaignId: string) {
    setError('');
    try {
      await acquireCampaignEditLock(campaignId);
      onOpenCampaign(campaignId);
    } catch (lockError) {
      setError(lockError instanceof Error ? lockError.message : 'Unable to open campaign for editing');
    }
  }

  async function handleOpenCampaignView(campaignId: string) {
    setViewDialogOpen(true);
    setViewCampaignId(campaignId);
    setViewLoading(true);
    setViewError('');
    setCampaignForView(null);
    try {
      await calculatePersistedCampaign(campaignId);
      const response = await fetchCampaign(campaignId);
      setCampaignForView(response.campaign);
    } catch (loadError) {
      setViewError(loadError instanceof Error ? loadError.message : 'Unable to load campaign details');
    } finally {
      setViewLoading(false);
    }
  }

  async function handleEditFromView() {
    if (!viewCampaignId) return;
    setViewDialogOpen(false);
    setCampaignForView(null);
    setViewError('');
    await handleOpenCampaign(viewCampaignId);
  }

  function campaignDisplayName(campaign: Pick<CampaignListItem, 'campaignName' | 'id'>) {
    return campaign.campaignName || `Untitled Campaign ${campaign.id.slice(0, 6)}`;
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
      const name = (campaign.campaignName || `Untitled Campaign ${campaign.id.slice(0, 6)}`).toLowerCase();
      return name.includes(query);
    });
  }, [campaigns, searchQuery]);

  return (
    <main className="dense-main flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden">
      {showHero ? (
        <section className="relative shrink-0 overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161231]/82 p-6 shadow-[0_24px_70px_rgba(2,6,23,0.42)] backdrop-blur-xl sm:p-7 xl:p-8">
          <div className="absolute -left-24 -top-20 h-64 w-64 rounded-full bg-violet-500/16 blur-3xl" />
          <div className="absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-violet-400/12 blur-3xl" />
          <div className="relative grid min-h-[324px] gap-6 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,1.18fr)] lg:items-center xl:min-h-[369px] xl:gap-10">
            <div className="max-w-xl">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">POWERED BY ADS</p>
              <h1 className="mt-2 text-[36px] font-semibold leading-tight tracking-tight text-[#F9FAFB] md:text-[42px] xl:text-[48px]">Plan Outdoor Campaigns Faster</h1>
              <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[#9CA3AF] xl:text-[16px]">Build schedules, review poster quantities, and generate ADS-ready quotes.</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  className="h-10 px-5 btn-theme-primary"
                  onClick={handleCreateCampaign}
                  type="button"
                >
                  Create Campaign
                </Button>
                <div className="flex h-10 w-[220px] items-center gap-2 rounded-lg border border-white/15 bg-[#15122b]/90 px-3 text-slate-200 shadow-[0_6px_20px_rgba(2,6,23,0.25)]">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search campaign"
                    type="text"
                    value={searchQuery}
                  />
                </div>
              </div>
            </div>
            <WorkflowIllustration />
          </div>
        </section>
      ) : null}

      {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 px-6 py-20">
          <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <Card className="border-white/10 bg-[#1a1733]">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
            <FolderKanban className="h-12 w-12 text-violet-300" />
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-white">{campaigns.length === 0 ? 'No campaign schedules yet' : 'No matching campaigns'}</h2>
              <p className="max-w-xl text-sm leading-6 text-slate-400">
                {campaigns.length === 0
                  ? 'Create your first campaign to start building a schedule, calculate totals, and submit it to PrintIQ.'
                  : 'Try another campaign name in the search box.'}
              </p>
            </div>
            <Button className="h-10 rounded-xl border border-violet-300/35 bg-violet-600 px-[18px] text-sm font-semibold text-white" onClick={handleCreateCampaign}>
              <Plus className="h-4 w-4" />
              Create Campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <section className="min-h-0 flex-1 overflow-auto rounded-md border border-white/10 bg-[#1a1733] shadow-[0_10px_24px_rgba(2,6,23,0.22)]">
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
                    rowIndex % 2 === 0 ? 'bg-[#241c45]/70' : 'bg-[#1a1733]'
                  } hover:bg-[#1d2a40]`}
                >
                  <td className="px-5 py-2.5 font-semibold text-white">
                    <button
                      className="block max-w-[320px] truncate whitespace-nowrap text-left text-white transition hover:text-violet-200"
                      onClick={() => void handleOpenCampaignView(campaign.id)}
                      title={campaignDisplayName(campaign)}
                      type="button"
                    >
                      {campaignDisplayName(campaign)}
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
                      <Button aria-label="View campaign" className="h-8 w-8 rounded-md border border-white/10 p-0 text-slate-200" onClick={() => void handleOpenCampaignView(campaign.id)} type="button" variant="ghost">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button aria-label="Edit campaign" className="h-8 w-8 rounded-md border border-white/10 p-0 text-slate-200" onClick={() => void handleOpenCampaign(campaign.id)} type="button" variant="ghost">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        aria-label="Delete campaign"
                        className={campaign.status === 'submitted'
                          ? 'h-8 w-8 cursor-not-allowed rounded-md border border-white/10 p-0 text-slate-600 opacity-60'
                          : 'h-8 w-8 rounded-md border border-white/10 p-0 text-rose-300'}
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

      <CampaignScheduleViewDialog
        campaign={campaignForView}
        error={viewError}
        loading={viewLoading}
        onClose={() => setViewDialogOpen(false)}
        onEdit={() => void handleEditFromView()}
        onOpenChange={(open) => {
          setViewDialogOpen(open);
          if (!open) {
            setViewLoading(false);
            setViewError('');
            setCampaignForView(null);
            setViewCampaignId(null);
          }
        }}
        open={viewDialogOpen}
      />

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
                {deletingCampaign ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-300" /> : <Trash2 className="h-4 w-4" />}
                {deletingCampaign ? 'Deleting...' : 'Delete Campaign'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
