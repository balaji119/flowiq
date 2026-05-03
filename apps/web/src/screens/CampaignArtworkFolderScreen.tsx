import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, FileText, LoaderCircle } from 'lucide-react';
import { Button } from '@flowiq/ui';
import { CampaignRecord } from '@flowiq/shared';
import { buildApiUrl } from '../services/apiBase';
import { fetchCampaign } from '../services/campaignApi';

type CampaignArtworkFolderScreenProps = {
  campaignId: string | null;
  onBack: () => void;
  onOpenCampaign: (campaignId: string) => void;
};

function toAbsoluteUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (typeof window !== 'undefined') {
    try {
      return new URL(trimmed, window.location.origin).toString();
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function extensionFromName(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === fileName.length - 1) return '';
  return fileName.slice(dotIndex + 1).toUpperCase();
}

function isPdfAsset(fileName: string, mimeType: string) {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType || '').toLowerCase();
  return lowerMime === 'application/pdf' || lowerName.endsWith('.pdf');
}

function triggerDownload(href: string, fileName: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function campaignFileDownloadUrl(url: string) {
  const resolvedUrl = new URL(url, window.location.origin);
  const segments = resolvedUrl.pathname.split('/').filter(Boolean);
  const storedName = segments[segments.length - 1];
  if (!storedName) return '';
  return new URL(`/campaign-files/${encodeURIComponent(storedName)}`, window.location.origin).toString();
}

function apiFileDownloadUrl(url: string, fileName: string) {
  const resolvedUrl = new URL(url, window.location.origin);
  const segments = resolvedUrl.pathname.split('/').filter(Boolean);
  const storedName = segments[segments.length - 1];
  if (!storedName) return '';
  const apiUrl = new URL(`/api/campaign-images/${encodeURIComponent(storedName)}/download`, window.location.origin);
  apiUrl.searchParams.set('filename', fileName);
  return apiUrl.toString();
}

export function CampaignArtworkFolderScreen({ campaignId, onBack, onOpenCampaign }: CampaignArtworkFolderScreenProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);

  useEffect(() => {
    let active = true;

    async function loadCampaign() {
      if (!campaignId) {
        setError('Campaign id is missing in the link.');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError('');
        const response = await fetchCampaign(campaignId);
        if (!active) return;
        setCampaign(response.campaign);
      } catch (loadError) {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Unable to load campaign artwork files');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadCampaign();
    return () => {
      active = false;
    };
  }, [campaignId]);

  const artworkFiles = useMemo(() => {
    return (campaign?.values.printImages ?? []).map((image) => {
      const fileName = image.fileName || image.name || 'Artwork';
      const resolvedUrl = toAbsoluteUrl(buildApiUrl(image.imageUrl || ''));
      const mimeType = image.mimeType || 'application/octet-stream';
      return {
        id: image.id,
        name: image.name || fileName,
        fileName,
        url: resolvedUrl,
        thumbnailUrl: image.thumbnailUrl ? toAbsoluteUrl(buildApiUrl(image.thumbnailUrl)) : '',
        mimeType,
      };
    }).filter((file) => isPdfAsset(file.fileName, file.mimeType));
  }, [campaign]);

  function openFile(url: string) {
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function downloadFile(url: string, fileName: string) {
    if (!url) return;
    void (async () => {
      setError('');
      const directDownloadUrl = campaignFileDownloadUrl(url);
      const fallbackApiUrl = apiFileDownloadUrl(url, fileName);
      if (!directDownloadUrl || !fallbackApiUrl) {
        setError('Invalid file URL');
        return;
      }

      try {
        const probe = await fetch(directDownloadUrl, { method: 'HEAD', cache: 'no-store' });
        if (probe.ok) {
          triggerDownload(directDownloadUrl, fileName);
          return;
        }
      } catch {
        // Fall back to API download endpoint below.
      }

      triggerDownload(fallbackApiUrl, fileName);
    })();
  }

  const campaignName = campaign?.values.campaignName?.trim() || (campaign?.id ? `Untitled Campaign ${campaign.id.slice(0, 6)}` : 'Campaign');

  return (
    <main className="dense-main mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <section className="relative overflow-hidden rounded-[32px] border border-slate-700/70 bg-slate-950/70 px-6 py-8 shadow-2xl shadow-slate-950/40">
        <div className="absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.2),transparent_52%)]" />
        <div className="relative grid min-h-[72px] grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div />
          <h1 className="text-center text-3xl font-black tracking-tight text-white sm:text-4xl">{campaignName}</h1>
          <div className="flex justify-end gap-2">
            <Button onClick={onBack} type="button" variant="outline">
              <ArrowLeft className="h-4 w-4" />
              Campaigns
            </Button>
            {campaign?.id ? (
              <Button onClick={() => onOpenCampaign(campaign.id)} type="button">
                Open Campaign
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 px-6 py-20">
          <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
        </div>
      ) : artworkFiles.length === 0 ? (
        <div className="rounded-md border border-slate-700 bg-slate-900/70 px-4 py-8 text-center text-sm text-slate-300">
          No artwork PDF files uploaded for this campaign.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-slate-700 bg-slate-900/60">
          <table className="dense-table w-full table-fixed border-collapse text-sm">
            <thead>
              <tr className="bg-slate-950 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                <th className="w-[14%] border border-slate-700 px-4 py-3 text-left">Thumbnail</th>
                <th className="w-[64%] border border-slate-700 px-4 py-3 text-left">File</th>
                <th className="w-[22%] border border-slate-700 px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {artworkFiles.map((file) => (
                <tr key={file.id} className="border-t border-slate-700/70 bg-slate-800/70">
                  <td className="border border-slate-700 px-4 py-3">
                    {file.thumbnailUrl ? (
                      <img
                        src={file.thumbnailUrl}
                        alt={file.fileName}
                        className="h-12 w-20 rounded border border-slate-600 object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-12 w-20 items-center justify-center rounded border border-slate-600 bg-slate-900 text-[10px] text-slate-400">
                        <FileText className="mr-1 h-3 w-3" />
                        PDF
                      </div>
                    )}
                  </td>
                  <td className="border border-slate-700 px-4 py-3 text-slate-200 break-words whitespace-normal">{file.fileName}</td>
                  <td className="border border-slate-700 px-4 py-3">
                    <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                      <Button
                        onClick={() => openFile(file.url)}
                        size="sm"
                        type="button"
                        variant="outline"
                        title="Open PDF"
                        aria-label="Open PDF"
                        className="h-9 w-9 px-0 2xl:h-9 2xl:w-auto 2xl:px-3"
                      >
                        <ExternalLink className="h-4 w-4" />
                        <span className="sr-only 2xl:not-sr-only 2xl:ml-2">Open</span>
                      </Button>
                      <Button
                        onClick={() => downloadFile(file.url, file.fileName)}
                        size="sm"
                        type="button"
                        title="Download PDF"
                        aria-label="Download PDF"
                        className="h-9 w-9 px-0 2xl:h-9 2xl:w-auto 2xl:px-3"
                      >
                        <Download className="h-4 w-4" />
                        <span className="sr-only 2xl:not-sr-only 2xl:ml-2">Download</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

