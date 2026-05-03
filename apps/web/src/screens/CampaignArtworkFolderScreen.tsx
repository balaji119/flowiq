import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, ExternalLink, FileText, LoaderCircle } from 'lucide-react';
import { Button } from '@flowiq/ui';
import { CampaignRecord } from '@flowiq/shared';
import { createPortal } from 'react-dom';
import { buildApiUrl } from '../services/apiBase';
import { fetchCampaign } from '../services/campaignApi';
import { PDFDocument } from 'pdf-lib';

type CampaignArtworkFolderScreenProps = {
  campaignId: string | null;
  onBack: () => void;
  onOpenCampaign: (campaignId: string) => void;
};

type ArtworkFileGroup = {
  key: string;
  fileName: string;
  thumbnailUrl: string;
  pages: Array<{ id: string; url: string; fileName: string; mimeType: string; pageNumber: number }>;
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

function triggerDownload(href: string, fileName: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = fileName;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
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

function withCampaignImageProxy(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname.startsWith('/api/campaign-images/')) {
      parsed.searchParams.set('proxy', '1');
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function toPdfGroupKey(name: string, fileName: string) {
  const normalizedName = (name || '').trim();
  const normalizedFileName = (fileName || '').trim();
  const fromName = normalizedName.replace(/\s*\(Page\s+\d+\)\s*$/i, '').trim();
  if (fromName) return fromName;
  const fromFile = normalizedFileName.replace(/\.[^.]+$/, '').replace(/-page-\d+$/i, '').trim();
  return fromFile || 'Artwork';
}

function toPdfFileName(groupKey: string) {
  const trimmed = groupKey.trim();
  if (!trimmed) return 'Artwork.pdf';
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
}

function getPageNumber(name: string, fileName: string) {
  const fromName = name.match(/\(Page\s+(\d+)\)/i);
  if (fromName) return Number.parseInt(fromName[1], 10) || 1;
  const fromFile = fileName.match(/-page-(\d+)/i);
  if (fromFile) return Number.parseInt(fromFile[1], 10) || 1;
  return 1;
}

async function createPdfFromImagePages(
  pages: Array<{ url: string; fileName: string; mimeType: string }>,
) {
  const pdfDoc = await PDFDocument.create();
  for (const page of pages) {
    const response = await fetch(withCampaignImageProxy(page.url), { cache: 'no-store' });
    if (!response.ok) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    const mimeType = (page.mimeType || '').toLowerCase();
    const lowerName = page.fileName.toLowerCase();
    const isJpeg = mimeType.includes('jpeg') || mimeType.includes('jpg') || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg');
    const embedded = isJpeg ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
    const pageRef = pdfDoc.addPage([embedded.width, embedded.height]);
    pageRef.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
    });
  }
  return pdfDoc.save();
}

export function CampaignArtworkFolderScreen({ campaignId, onBack, onOpenCampaign }: CampaignArtworkFolderScreenProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [topBarCenterHost, setTopBarCenterHost] = useState<HTMLElement | null>(null);
  const [topBarActionsHost, setTopBarActionsHost] = useState<HTMLElement | null>(null);
  const [pendingActionKey, setPendingActionKey] = useState<string | null>(null);

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

  useEffect(() => {
    setTopBarCenterHost(document.getElementById('workspace-topbar-center-slot'));
    setTopBarActionsHost(document.getElementById('workspace-topbar-actions-slot'));
  }, []);

  const artworkFiles = useMemo(() => {
    const grouped = new Map<string, ArtworkFileGroup>();

    (campaign?.values.printImages ?? []).forEach((image) => {
      const sourcePdfFileName = (image.sourcePdfFileName || '').trim();
      const sourcePdfStoredName = (image.sourcePdfStoredName || '').trim();
      const sourcePdfUrl = (image.sourcePdfUrl || '').trim();
      const hasSourcePdf = Boolean(sourcePdfFileName || sourcePdfStoredName || sourcePdfUrl);
      const groupBaseName = toPdfGroupKey(image.name || '', image.fileName || image.name || 'Artwork');
      const groupKey = hasSourcePdf
        ? (sourcePdfStoredName || sourcePdfFileName || groupBaseName)
        : groupBaseName;
      const fileName = hasSourcePdf
        ? (sourcePdfFileName || toPdfFileName(groupBaseName))
        : (image.fileName || image.name || 'Artwork');
      const rawUrl = hasSourcePdf ? sourcePdfUrl : (image.imageUrl || '');
      const url = toAbsoluteUrl(buildApiUrl(rawUrl));
      if (!url) return;
      const key = groupKey.trim() || groupBaseName;
      const pageNumber = hasSourcePdf ? 1 : getPageNumber(image.name || '', image.fileName || fileName);
      const current = grouped.get(key) ?? {
        key,
        fileName: hasSourcePdf ? fileName : toPdfFileName(key),
        thumbnailUrl: image.thumbnailUrl ? toAbsoluteUrl(buildApiUrl(image.thumbnailUrl)) : '',
        pages: [],
      };
      if (!current.thumbnailUrl && image.thumbnailUrl) {
        current.thumbnailUrl = toAbsoluteUrl(buildApiUrl(image.thumbnailUrl));
      }
      const nextPage = {
        id: image.id,
        url,
        fileName,
        mimeType: hasSourcePdf ? 'application/pdf' : (image.mimeType || 'application/octet-stream'),
        pageNumber,
      };
      if (!current.pages.some((page) => page.url === nextPage.url)) {
        current.pages.push(nextPage);
      }
      grouped.set(key, current);
    });

    return Array.from(grouped.values())
      .map((group) => ({
        ...group,
        pages: [...group.pages].sort((a, b) => a.pageNumber - b.pageNumber),
      }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
  }, [campaign]);

  function openFile(group: ArtworkFileGroup) {
    void (async () => {
      setError('');
      const actionKey = `${group.key}:open`;
      const startedAt = Date.now();
      setPendingActionKey(actionKey);
      try {
        if (group.pages.length === 1 && group.pages[0].mimeType.toLowerCase() === 'application/pdf') {
          window.open(group.pages[0].url, '_blank', 'noopener,noreferrer');
          return;
        }
        const pdfBytes = await createPdfFromImagePages(group.pages);
        const pdfBuffer = new Uint8Array(pdfBytes).buffer;
        const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
        const objectUrl = URL.createObjectURL(pdfBlob);
        window.open(objectUrl, '_blank', 'noopener,noreferrer');
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : 'Unable to open artwork PDF');
      } finally {
        const elapsed = Date.now() - startedAt;
        const minFeedbackMs = 600;
        if (elapsed < minFeedbackMs) {
          await new Promise((resolve) => window.setTimeout(resolve, minFeedbackMs - elapsed));
        }
        setPendingActionKey((current) => (current === actionKey ? null : current));
      }
    })();
  }

  function downloadFile(group: ArtworkFileGroup) {
    void (async () => {
      setError('');
      const actionKey = `${group.key}:download`;
      const startedAt = Date.now();
      setPendingActionKey(actionKey);
      try {
        if (group.pages.length === 1 && group.pages[0].mimeType.toLowerCase() === 'application/pdf') {
          const downloadUrl = apiFileDownloadUrl(group.pages[0].url, group.fileName);
          if (!downloadUrl) {
            setError('Invalid file URL');
            return;
          }
          triggerDownload(downloadUrl, group.fileName);
          return;
        }
        const pdfBytes = await createPdfFromImagePages(group.pages);
        const pdfBuffer = new Uint8Array(pdfBytes).buffer;
        const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
        const objectUrl = URL.createObjectURL(pdfBlob);
        triggerDownload(objectUrl, group.fileName);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
      } catch (downloadError) {
        setError(downloadError instanceof Error ? downloadError.message : 'Unable to download artwork PDF');
      } finally {
        const elapsed = Date.now() - startedAt;
        const minFeedbackMs = 900;
        if (elapsed < minFeedbackMs) {
          await new Promise((resolve) => window.setTimeout(resolve, minFeedbackMs - elapsed));
        }
        setPendingActionKey((current) => (current === actionKey ? null : current));
      }
    })();
  }

  const campaignName = campaign?.values.campaignName?.trim() || (campaign?.id ? `Untitled Campaign ${campaign.id.slice(0, 6)}` : 'Campaign');

  return (
    <main className="dense-main mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      {topBarCenterHost
        ? createPortal(
            <h1 className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300" title={campaignName}>
              {campaignName}
            </h1>,
            topBarCenterHost,
          )
        : null}
      {topBarActionsHost
        ? createPortal(
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
            </div>,
            topBarActionsHost,
          )
        : null}

      {error ? <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">{error}</div> : null}

      {loading ? (
        <div className="flex items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 px-6 py-20">
          <LoaderCircle className="h-6 w-6 animate-spin text-violet-300" />
        </div>
      ) : artworkFiles.length === 0 ? (
        <div className="rounded-md border border-slate-700 bg-slate-900/70 px-4 py-8 text-center text-sm text-slate-300">
          No artwork files uploaded for this campaign.
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
                <tr key={file.key} className="border-t border-slate-700/70 bg-slate-800/70">
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
                    {(() => {
                      const openBusy = pendingActionKey === `${file.key}:open`;
                      const downloadBusy = pendingActionKey === `${file.key}:download`;
                      const rowBusy = openBusy || downloadBusy;
                      return (
                    <div className="flex items-center justify-center gap-2 whitespace-nowrap">
                      <Button
                        onClick={() => openFile(file)}
                        disabled={rowBusy}
                        size="sm"
                        type="button"
                        variant="outline"
                        title={openBusy ? 'Opening PDF...' : 'Open PDF'}
                        aria-label={openBusy ? 'Opening PDF' : 'Open PDF'}
                        className="h-9 w-9 px-0 2xl:h-9 2xl:w-auto 2xl:px-3"
                      >
                        {openBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                        <span className="sr-only 2xl:not-sr-only 2xl:ml-2">{openBusy ? 'Opening...' : 'Open'}</span>
                      </Button>
                      <Button
                        onClick={() => downloadFile(file)}
                        disabled={rowBusy}
                        size="sm"
                        type="button"
                        title={downloadBusy ? 'Downloading PDF...' : 'Download PDF'}
                        aria-label={downloadBusy ? 'Downloading PDF' : 'Download PDF'}
                        className="h-9 w-9 px-0 2xl:h-9 2xl:w-auto 2xl:px-3"
                      >
                        {downloadBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        <span className="sr-only 2xl:not-sr-only 2xl:ml-2">{downloadBusy ? 'Downloading...' : 'Download'}</span>
                      </Button>
                    </div>
                      );
                    })()}
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

