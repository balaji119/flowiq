'use client';

import { PropsWithChildren, createContext, useContext, useMemo, useRef, useState } from 'react';
import { CampaignPrintImage } from '@flowiq/shared';
import { Check, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { processArtworkPdf } from '../services/artworkUploadProcessor';

export type ArtworkUploadJob = {
  id: string;
  campaignId: string;
  tenantId?: string | null;
  fileName: string;
  status: 'queued' | 'uploading' | 'completed' | 'error';
  images: CampaignPrintImage[];
  error?: string;
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
  removeQueuedUpload: (jobId: string) => void;
  dismissUploadJobs: (jobIds: string[]) => void;
};

const ArtworkUploadContext = createContext<ArtworkUploadContextValue | null>(null);

export function ArtworkUploadProvider({ children }: PropsWithChildren) {
  const [jobs, setJobs] = useState<ArtworkUploadJob[]>([]);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const queueRef = useRef<QueuedArtworkUpload[]>([]);
  const workerActiveRef = useRef(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showNotice(kind: 'success' | 'error', message: string) {
    setNotice({ kind, message });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), kind === 'success' ? 6000 : 12000);
  }

  async function processQueue() {
    if (workerActiveRef.current) return;
    workerActiveRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift();
        if (!next) continue;
        setJobs((current) => current.map((job) => (job.id === next.jobId ? { ...job, status: 'uploading' } : job)));
        try {
          const result = await processArtworkPdf(next.campaignId, next.tenantId, next.file);
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
      })),
    ]);
    void processQueue();
    return queued.map((item) => item.jobId);
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
    () => ({ jobs, enqueueArtworkFiles, removeQueuedUpload, dismissUploadJobs }),
    [jobs],
  );
  const activeJobs = jobs.filter((job) => job.status === 'queued' || job.status === 'uploading');

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
                  {activeJobs[0].fileName}{activeJobs.length > 1 ? ` and ${activeJobs.length - 1} more` : ''}
                </p>
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
