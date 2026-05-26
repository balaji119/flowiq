import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Eye, FolderKanban, LoaderCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { CampaignListItem, CampaignRecord } from '@flowiq/shared';
import { Button, Card, CardContent, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@flowiq/ui';
import { acquireCampaignEditLock, calculatePersistedCampaign, deleteCampaign, fetchCampaign, fetchCampaigns } from '../services/campaignApi';
import { CampaignScheduleViewDialog } from './CampaignScheduleViewDialog';

type CampaignLandingScreenProps = {
  onOpenCampaign: (campaignId: string | null) => void;
  showHero?: boolean;
};

const LANDING_NOTICE_KEY = 'flowiq:landing-notice';

function formatCampaignDate(value: string) {
  if (!value) return 'TBC';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB');
}

function formatCampaignStatus(status: CampaignListItem['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function WorkflowIllustration() {
  return (
    <div className="relative h-[205px] w-full bg-transparent p-0 sm:h-[223px] lg:h-[248px] xl:h-[268px]">
      <svg className="relative h-full w-full" fill="none" viewBox="34 14 548 280" xmlns="http://www.w3.org/2000/svg">
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
  const [landingNotice, setLandingNotice] = useState('');
  const [bottomBarHost, setBottomBarHost] = useState<HTMLElement | null>(null);

  const loadCampaigns = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetchCampaigns();
      setCampaigns(response.campaigns);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load campaign schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    setBottomBarHost(document.getElementById('workspace-bottom-bar-slot'));
    try {
      const message = window.sessionStorage.getItem(LANDING_NOTICE_KEY) || '';
      if (message.trim()) {
        setLandingNotice(message);
        window.sessionStorage.removeItem(LANDING_NOTICE_KEY);
      }
    } catch {
      // Ignore storage errors.
    }
  }, []);

  useEffect(() => {
    if (!landingNotice) return undefined;
    const timeoutId = window.setTimeout(() => {
      setLandingNotice('');
    }, 4000);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [landingNotice]);

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
    <main className="dashboard-default-scale dense-main flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden">
      {showHero ? (
        <section className="relative shrink-0 overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#161231]/70 px-6 pb-3 pt-2 shadow-[0_24px_70px_rgba(2,6,23,0.42)] backdrop-blur-xl sm:px-7 sm:pb-4 sm:pt-3 xl:px-8 xl:pb-5 xl:pt-4">
          <div className="absolute -left-24 -top-20 h-64 w-64 rounded-full bg-violet-500/16 blur-3xl" />
          <div className="absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-violet-400/12 blur-3xl" />
          <div className="relative grid min-h-[216px] items-start gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start xl:min-h-[243px] xl:gap-11">
            <div className="max-w-xl pt-2 lg:self-stretch lg:flex lg:flex-col">
              <div className="mb-5 w-fit max-w-full">
                <img
                  alt="Revolution360"
                  className="h-auto w-[320px] max-w-full md:w-[390px] xl:w-[460px]"
                  src="/images/revolution360-wordmark-white.png"
                />
                <p className="-mt-0.5 text-right text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">POWERED BY ADS</p>
              </div>
              <h1 className="mt-3 pl-3 overflow-hidden text-ellipsis whitespace-nowrap text-[29px] font-semibold leading-tight tracking-tight text-[#F9FAFB] md:text-[33px] xl:text-[37px]">Plan Outdoor Campaigns Faster</h1>
              <p className="mt-3 max-w-xl pl-3 text-[16px] leading-relaxed text-[#9CA3AF] xl:text-[17px]">Build schedules, review poster quantities, and generate ADS-ready orders.</p>
              <div className="mt-10 flex flex-wrap items-center gap-3 pl-3 lg:mt-auto">
                <Button
                  className="h-11 px-6 text-[15px] btn-theme-primary"
                  onClick={handleCreateCampaign}
                  type="button"
                >
                  Create Campaign
                </Button>
                <div className="flex h-11 w-[250px] items-center gap-2 rounded-lg border border-white/15 bg-[#15122b]/90 px-3 text-slate-200 shadow-[0_6px_20px_rgba(2,6,23,0.25)]">
                  <Search className="h-[18px] w-[18px] shrink-0 text-slate-400" />
                  <input
                    className="w-full bg-transparent text-[15px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
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
          <table className="dense-table min-w-[1240px] w-full border-collapse text-[14px]">
            <thead>
              <tr className="bg-slate-950/65 text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-200">
                <th className="sticky top-0 z-10 w-[24%] border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Campaign</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Created By</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Created At</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Updated By</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Updated At</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-center backdrop-blur">Markets</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-center backdrop-blur">Assets</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Start</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-left backdrop-blur">Due</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-center backdrop-blur">Weeks</th>
                <th className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/82 px-5 py-2.5 text-center backdrop-blur">Status</th>
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
                  <td className="w-[24%] px-5 py-2.5 font-semibold text-white">
                    <button
                      className="block w-full truncate whitespace-nowrap text-left text-white transition hover:text-violet-200"
                      onClick={() => void handleOpenCampaignView(campaign.id)}
                      title={campaignDisplayName(campaign)}
                      type="button"
                    >
                      {campaignDisplayName(campaign)}
                    </button>
                  </td>
                  <td className="px-5 py-2.5 text-slate-300">{campaign.createdBy || 'N/A'}</td>
                  <td className="px-5 py-2.5 text-slate-300">{new Date(campaign.createdAt).toLocaleString('en-GB')}</td>
                  <td className="px-5 py-2.5 text-slate-300">{campaign.updatedBy || 'N/A'}</td>
                  <td className="px-5 py-2.5 text-slate-300">{new Date(campaign.updatedAt).toLocaleString('en-GB')}</td>
                  <td className="px-5 py-2.5 text-center font-semibold text-white">{campaign.marketCount}</td>
                  <td className="px-5 py-2.5 text-center font-semibold text-white">{campaign.assetCount}</td>
                  <td className="px-5 py-2.5 text-slate-300">{formatCampaignDate(campaign.campaignStartDate)}</td>
                  <td className="px-5 py-2.5 text-slate-300">{formatCampaignDate(campaign.dueDate)}</td>
                  <td className="px-5 py-2.5 text-center text-slate-300">{campaign.numberOfWeeks || '0'}</td>
                  <td className="px-5 py-2.5 text-center">
                    <span className={campaign.status === 'submitted'
                      ? 'inline-flex rounded-full border border-emerald-300/35 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-200'
                      : campaign.status === 'calculated'
                        ? 'inline-flex rounded-full border border-sky-300/35 bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-sky-200'
                        : 'inline-flex rounded-full border border-amber-300/35 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-200'}
                    >
                      {formatCampaignStatus(campaign.status)}
                    </span>
                  </td>
                  <td className="px-5 py-2.5">
                    <div className="flex justify-center gap-2">
                      <Button aria-label="View campaign" className="h-8 w-8 rounded-md border border-white/10 p-0 text-slate-200" onClick={() => void handleOpenCampaignView(campaign.id)} type="button" variant="ghost">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        aria-label="Edit campaign"
                        className="h-8 w-8 rounded-md border border-white/10 p-0 text-slate-200"
                        onClick={() => void handleOpenCampaign(campaign.id)}
                        title="Edit campaign"
                        type="button"
                        variant="ghost"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        aria-label="Delete campaign"
                        className="h-8 w-8 rounded-md border border-white/10 p-0 text-rose-300"
                        onClick={() => openDeleteDialog(campaign)}
                        title="Delete campaign"
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
            void loadCampaigns();
            setViewLoading(false);
            setViewError('');
            setCampaignForView(null);
            setViewCampaignId(null);
          }
        }}
        open={viewDialogOpen}
      />

      {landingNotice
        ? (bottomBarHost
            ? createPortal(
                <div className="z-20 border-t border-slate-800/90 bg-slate-950/92 backdrop-blur">
                  <div className="w-full px-3 py-2 sm:px-4 lg:px-5">
                    <div className="px-1 py-1 text-sm text-slate-300" role="status">{landingNotice}</div>
                  </div>
                </div>,
                bottomBarHost,
              )
            : null)
        : null}

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
