'use client';

import { PropsWithChildren, createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CampaignPrintImage } from '@flowiq/shared';
import { Check, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { processArtworkPdf } from '../services/artworkUploadProcessor';
import { OneDriveImportJob, OneDriveSelection, createOneDriveArtworkImport, fetchOneDriveArtworkImport, listOneDriveArtworkImports } from '../services/oneDriveApi';
import { useAuth } from './AuthContext';

export type ArtworkUploadJob = {
  id: string;
  campaignId: string;
  tenantId?: string | null;
  fileName: string;
  status: 'queued' | 'uploading' | 'completed' | 'error';
  images: CampaignPrintImage[];
  error?: string;
  uploadedBytes?: number;
  totalBytes?: number;
  phase?: 'uploading-source' | 'finalizing-source' | 'processing-pdf' | 'uploading-pages' | 'onedrive-downloading' | 'onedrive-processing' | 'saving';
  phaseCurrent?: number;
  phaseTotal?: number;
  origin?: 'local' | 'onedrive';
};

type QueuedArtworkUpload = {
  jobId: string;
  campaignId: string;
  tenantId?: string | null;
  file: File;
};

type ArtworkUploadContextValue = {
  jobs: ArtworkUploadJob[];
  enqueueArtworkFiles: (campaignId: string, tenantId: string | null | undefined, files: File[]) => string[];
  enqueueOneDriveFiles: (campaignId: string, tenantId: string | null | undefined, selections: OneDriveSelection[], accessToken: string) => Promise<string[]>;
  removeQueuedUpload: (jobId: string) => void;
  dismissUploadJobs: (jobIds: string[]) => void;
};

const ArtworkUploadContext = createContext<ArtworkUploadContextValue | null>(null);

export function ArtworkUploadProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const [jobs, setJobs] = useState<ArtworkUploadJob[]>([]);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const queueRef = useRef<QueuedArtworkUpload[]>([]);
  const workerActiveRef = useRef(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const monitoredOneDriveRef = useRef(new Set<string>());

  function showNotice(kind: 'success' | 'error', message: string) {
    setNotice({ kind, message });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), kind === 'success' ? 6000 : 12000);
  }

  function toArtworkJob(remoteJob: OneDriveImportJob): ArtworkUploadJob {
    return {
      id: remoteJob.id,
      campaignId: remoteJob.campaignId,
      fileName: remoteJob.fileName,
      status: remoteJob.status === 'completed' ? 'completed' : remoteJob.status === 'error' ? 'error' : 'uploading',
      images: remoteJob.images,
      error: remoteJob.error,
      uploadedBytes: remoteJob.downloadedBytes,
      totalBytes: remoteJob.totalBytes,
      phase: remoteJob.status === 'queued' || remoteJob.status === 'downloading'
        ? 'onedrive-downloading'
        : remoteJob.status === 'processing'
          ? 'onedrive-processing'
          : 'saving',
      phaseCurrent: remoteJob.processedPages,
      phaseTotal: remoteJob.totalPages,
      origin: 'onedrive',
    };
  }

  function monitorOneDriveJob(initialJob: OneDriveImportJob) {
    if (monitoredOneDriveRef.current.has(initialJob.id)) return;
    monitoredOneDriveRef.current.add(initialJob.id);
    void (async () => {
      let remoteJob = initialJob;
      try {
        while (monitoredOneDriveRef.current.has(remoteJob.id) && remoteJob.status !== 'completed' && remoteJob.status !== 'error') {
          setJobs((current) => current.map((job) => job.id === remoteJob.id ? { ...job, ...toArtworkJob(remoteJob) } : job));
          await new Promise((resolve) => setTimeout(resolve, 2000));
          try {
            remoteJob = (await fetchOneDriveArtworkImport(remoteJob.id)).import;
          } catch {
            // Polling is only a view of the server job. A temporary browser/network
            // failure must never cancel or fail the durable import.
            await new Promise((resolve) => setTimeout(resolve, 3000));
          }
        }
        if (!monitoredOneDriveRef.current.has(remoteJob.id)) return;
        setJobs((current) => current.map((job) => job.id === remoteJob.id ? { ...job, ...toArtworkJob(remoteJob) } : job));
        if (remoteJob.status === 'error') {
          showNotice('error', `${remoteJob.fileName}: ${remoteJob.error || 'Unable to import artwork from OneDrive'}`);
        } else if (remoteJob.status === 'completed') {
          showNotice('success', `${remoteJob.fileName} imported from OneDrive (${remoteJob.images.length} artwork page${remoteJob.images.length === 1 ? '' : 's'}).`);
        }
      } finally {
        monitoredOneDriveRef.current.delete(remoteJob.id);
      }
    })();
  }

  useEffect(() => {
    monitoredOneDriveRef.current.clear();
    setJobs((current) => current.filter((job) => job.origin !== 'onedrive'));
    if (!session) return;
    let active = true;
    void listOneDriveArtworkImports()
      .then(({ imports }) => {
        if (!active) return;
        setJobs((current) => {
          const localJobs = current.filter((job) => job.origin !== 'onedrive');
          return [...localJobs, ...imports.map(toArtworkJob)];
        });
        imports
          .filter((job) => job.status !== 'completed' && job.status !== 'error')
          .forEach(monitorOneDriveJob);
      })
      .catch(() => {
        // Authentication bootstrap or a temporary network outage may race this
        // request. Newly opened screens can still start imports normally.
      });
    return () => {
      active = false;
      monitoredOneDriveRef.current.clear();
    };
  }, [session?.user.id]);

  async function processQueue() {
    if (workerActiveRef.current) return;
    workerActiveRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (!next) continue;
        setJobs((current) => current.map((job) => (job.id === next.jobId ? { ...job, status: 'uploading' } : job)));
        try {
          const result = await processArtworkPdf(next.campaignId, next.tenantId, next.file, (progress) => {
            setJobs((current) => current.map((job) => (
              job.id === next.jobId
                ? {
                    ...job,
                    phase: progress.phase,
                    uploadedBytes: progress.uploadedBytes,
                    totalBytes: progress.totalBytes,
                    phaseCurrent: progress.current,
                    phaseTotal: progress.total,
                  }
                : job
            )));
          });
          setJobs((current) => current.map((job) => (
            job.id === next.jobId ? { ...job, status: 'completed', images: result.images } : job
          )));
          showNotice('success', `${next.file.name} uploaded successfully (${result.images.length} artwork page${result.images.length === 1 ? '' : 's'}).`);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to upload artwork PDF';
          setJobs((current) => current.map((job) => (job.id === next.jobId ? { ...job, status: 'error', error: message } : job)));
          showNotice('error', `${next.file.name}: ${message}`);
        }
      }
    } finally {
      workerActiveRef.current = false;
    }
  }

  function enqueueArtworkFiles(campaignId: string, tenantId: string | null | undefined, files: File[]) {
    const queued = files.map((file) => ({
      jobId: crypto.randomUUID(),
      campaignId,
      tenantId,
      file,
    }));
    queueRef.current.push(...queued);
    setJobs((current) => [
      ...current,
      ...queued.map<ArtworkUploadJob>((item) => ({
        id: item.jobId,
        campaignId: item.campaignId,
        tenantId: item.tenantId,
        fileName: item.file.name,
        status: 'queued',
        images: [],
        origin: 'local',
      })),
    ]);
    void processQueue();
    return queued.map((item) => item.jobId);
  }

  async function enqueueOneDriveFile(
    campaignId: string,
    tenantId: string | null | undefined,
    selection: OneDriveSelection,
    accessToken: string,
  ) {
    const localJobId = crypto.randomUUID();
    setJobs((current) => [
      ...current,
      {
        id: localJobId,
        campaignId,
        tenantId,
        fileName: selection.name,
        status: 'uploading',
        images: [],
        phase: 'onedrive-downloading',
        uploadedBytes: 0,
        totalBytes: selection.size,
        origin: 'onedrive',
      },
    ]);
    let remoteJob: OneDriveImportJob;
    try {
      remoteJob = (await createOneDriveArtworkImport(campaignId, tenantId, selection, accessToken)).import;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to import artwork from OneDrive';
      setJobs((current) => current.map((job) => job.id === localJobId ? { ...job, status: 'error', error: message } : job));
      showNotice('error', `${selection.name}: ${message}`);
      throw error;
    }
    setJobs((current) => current.map((job) => job.id === localJobId ? toArtworkJob(remoteJob) : job));
    monitorOneDriveJob(remoteJob);
    return remoteJob.id;
  }

  async function enqueueOneDriveFiles(
    campaignId: string,
    tenantId: string | null | undefined,
    selections: OneDriveSelection[],
    accessToken: string,
  ) {
    const jobIds: string[] = [];
    for (const selection of selections) {
      // Keep each OneDrive PDF independent so a single failure doesn't block the rest.
      // The underlying server-side processing already runs one import job per file.
      jobIds.push(await enqueueOneDriveFile(campaignId, tenantId, selection, accessToken));
    }
    return jobIds;
  }

  function removeQueuedUpload(jobId: string) {
    queueRef.current = queueRef.current.filter((item) => item.jobId !== jobId);
    setJobs((current) => current.filter((job) => job.id !== jobId || job.status !== 'queued'));
  }

  function dismissUploadJobs(jobIds: string[]) {
    const ids = new Set(jobIds);
    setJobs((current) => current.filter((job) => !ids.has(job.id)));
  }

  const value = useMemo<ArtworkUploadContextValue>(
    () => ({ jobs, enqueueArtworkFiles, enqueueOneDriveFiles, removeQueuedUpload, dismissUploadJobs }),
    [jobs],
  );
  const activeJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'uploading');
  const activeJob = activeJobs[0];
  const activeProgress = (activeJob?.phase === 'uploading-source' || activeJob?.phase === 'onedrive-downloading') && activeJob.totalBytes
    ? Math.min(100, Math.round(((activeJob.uploadedBytes ?? 0) / activeJob.totalBytes) * 100))
    : (activeJob?.phase === 'processing-pdf' || activeJob?.phase === 'uploading-pages' || activeJob?.phase === 'onedrive-processing') && activeJob.phaseTotal
      ? Math.min(100, Math.round(((activeJob.phaseCurrent ?? 0) / activeJob.phaseTotal) * 100))
      : null;
  const activePhaseLabel = (() => {
    if (!activeJob || activeJob.status === 'queued') return 'Waiting to start';
    if (activeJob.phase === 'uploading-source') return `${activeProgress ?? 0}% — Uploading original PDF`;
    if (activeJob.phase === 'finalizing-source') return 'Finalizing uploaded PDF';
    if (activeJob.phase === 'onedrive-downloading') return `${activeProgress ?? 0}% — Importing original PDF from OneDrive`;
    if (activeJob.phase === 'onedrive-processing') {
      return activeJob.phaseTotal
        ? `Processing imported PDF page ${activeJob.phaseCurrent ?? 0} of ${activeJob.phaseTotal}`
        : 'Reading imported PDF and preparing pages';
    }
    if (activeJob.phase === 'processing-pdf') {
      return activeJob.phaseTotal
        ? `Processing PDF page ${activeJob.phaseCurrent ?? 0} of ${activeJob.phaseTotal}`
        : 'Reading PDF and preparing pages';
    }
    if (activeJob.phase === 'uploading-pages') {
      return `Uploading artwork page ${activeJob.phaseCurrent ?? 0} of ${activeJob.phaseTotal ?? 0}`;
    }
    if (activeJob.phase === 'saving') return 'Saving artwork to campaign';
    return 'Preparing artwork upload';
  })();

  return (
    <ArtworkUploadContext.Provider value={value}>
      {children}
      {activeJobs.length > 0 || notice ? (
        <div className="fixed bottom-4 right-4 z-[2147483647] w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-slate-600 bg-slate-950/95 p-3 text-slate-100 shadow-2xl shadow-black/60 backdrop-blur">
          {activeJobs.length > 0 ? (
            <div className="flex items-start gap-3">
              <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-violet-300" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Uploading artwork</p>
                <p className="mt-1 truncate text-xs text-slate-400">
                  {activeJob?.fileName}{activeJobs.length > 1 ? ` and ${activeJobs.length - 1} more` : ''}
                </p>
                {activeProgress !== null ? (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-violet-400 transition-[width]" style={{ width: `${activeProgress}%` }} />
                    </div>
                  </div>
                ) : null}
                <p className="mt-2 text-xs font-medium text-slate-300">{activePhaseLabel}</p>
                <p className="mt-1 text-xs text-slate-500">Upload continues while you use the dashboard.</p>
              </div>
            </div>
          ) : null}
          {notice ? (
            <div className={activeJobs.length > 0 ? 'mt-3 border-t border-slate-700 pt-3' : ''}>
              <div className="flex items-start gap-3">
                {notice.kind === 'success'
                  ? <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
                  : <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />}
                <p className="min-w-0 flex-1 text-xs text-slate-200">{notice.message}</p>
                <button aria-label="Dismiss upload notification" className="text-slate-400 hover:text-white" onClick={() => setNotice(null)} type="button">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </ArtworkUploadContext.Provider>
  );
}

export function useArtworkUploads() {
  const context = useContext(ArtworkUploadContext);
  if (!context) throw new Error('useArtworkUploads must be used inside ArtworkUploadProvider');
  return context;
}
