'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Cloud, FileText, Folder, LoaderCircle } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, cn } from '@flowiq/ui';
import {
  OneDriveBrowserItem,
  OneDriveSelection,
  acquireOneDriveAccessToken,
  connectOneDrive,
  getOneDriveConfiguration,
  listOneDriveItems,
  oneDriveAuthErrorCode,
} from '../services/oneDriveApi';

type FolderLocation = { driveId?: string; folderId?: string; name: string };

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index >= 3 ? 2 : 1)} ${units[index]}`;
}

export function OneDriveArtworkImportDialog({
  open,
  onOpenChange,
  onImport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (selections: OneDriveSelection[], accessToken: string) => Promise<void>;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [accessToken, setAccessToken] = useState('');
  const [items, setItems] = useState<OneDriveBrowserItem[]>([]);
  const [locations, setLocations] = useState<FolderLocation[]>([{ name: 'OneDrive' }]);
  const [selected, setSelected] = useState<OneDriveSelection[]>([]);
  const [loading, setLoading] = useState(false);
  const [loginRetryRequired, setLoginRetryRequired] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const connectInFlightRef = useRef(false);

  async function loadLocation(token: string, location: FolderLocation) {
    setLoading(true);
    setError('');
    try {
      setItems(await listOneDriveItems(token, location.driveId, location.folderId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load OneDrive files');
    } finally {
      setLoading(false);
    }
  }

  async function handleConnect(overrideInteractionInProgress = false) {
    if (connectInFlightRef.current) return;
    connectInFlightRef.current = true;
    setLoading(true);
    setError('');
    try {
      const token = await connectOneDrive(overrideInteractionInProgress);
      setLoginRetryRequired(false);
      setAccessToken(token);
      const root = { name: 'OneDrive' };
      setLocations([root]);
      setSelected([]);
      await loadLocation(token, root);
    } catch (connectError) {
      const errorCode = oneDriveAuthErrorCode(connectError);
      const canRetry = errorCode === 'interaction_in_progress' || errorCode === 'timed_out';
      setLoginRetryRequired(canRetry);
      setError(canRetry
        ? 'The previous Microsoft sign-in did not finish. Close any old sign-in popup, then choose Retry OneDrive.'
        : connectError instanceof Error ? connectError.message : 'Unable to connect to OneDrive');
      setLoading(false);
    } finally {
      connectInFlightRef.current = false;
    }
  }

  async function openFolder(item: OneDriveBrowserItem) {
    const driveId = item.parentReference?.driveId;
    if (!driveId) {
      setError('OneDrive did not return a drive identifier for this folder.');
      return;
    }
    const location = { driveId, folderId: item.id, name: item.name };
    setLocations((current) => [...current, location]);
    await loadLocation(accessToken, location);
  }

  async function goBack() {
    if (locations.length <= 1) return;
    const nextLocations = locations.slice(0, -1);
    setLocations(nextLocations);
    await loadLocation(accessToken, nextLocations[nextLocations.length - 1]);
  }

  async function handleImport() {
    if (selected.length === 0) return;
    setImporting(true);
    setError('');
    try {
      const freshToken = await acquireOneDriveAccessToken();
      await onImport(selected, freshToken);
      onOpenChange(false);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Unable to start OneDrive import');
    } finally {
      setImporting(false);
    }
  }

  useEffect(() => {
    if (open && configured === null) {
      void getOneDriveConfiguration()
        .then((configuration) => setConfigured(configuration.enabled))
        .catch((configurationError) => {
          setConfigured(false);
          setError(configurationError instanceof Error ? configurationError.message : 'Unable to load OneDrive configuration');
        });
    }
    if (!open) {
      setSelected([]);
      setError('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ width: 'min(calc(100vw - 2rem), 46rem)', maxHeight: '90vh' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Cloud className="h-5 w-5 text-sky-300" /> Import from OneDrive</DialogTitle>
          <DialogDescription>The file transfers directly from OneDrive to FlowIQ. You can continue working while it imports.</DialogDescription>
        </DialogHeader>

        {configured === null ? (
          <div className="flex min-h-52 items-center justify-center gap-2 text-sm text-slate-400"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading OneDrive configuration...</div>
        ) : !configured ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            OneDrive is not configured. Add <code>ONEDRIVE_CLIENT_ID</code> to the API environment and register this site URL as a Single-page application redirect URI in Microsoft Entra.
          </div>
        ) : !accessToken ? (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-md border border-slate-700 bg-slate-950/60 px-6 text-center">
            <Cloud className="h-10 w-10 text-sky-300" />
            <p className="mt-3 text-sm font-semibold text-slate-100">Connect your Microsoft account</p>
            <p className="mt-1 max-w-md text-xs text-slate-400">FlowIQ requests read-only access so you can choose artwork PDFs.</p>
            <Button className="mt-4" disabled={loading} onClick={() => void handleConnect(loginRetryRequired)} type="button">
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
              {loginRetryRequired ? 'Retry OneDrive' : 'Connect OneDrive'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-950/70 px-3 py-2">
              <Button disabled={locations.length <= 1 || loading} onClick={() => void goBack()} size="sm" type="button" variant="secondary">Back</Button>
              <p className="min-w-0 flex-1 truncate text-sm text-slate-300">{locations.map((location) => location.name).join(' / ')}</p>
            </div>
            <div className="max-h-[45vh] min-h-64 overflow-auto rounded-md border border-slate-700 bg-slate-950/50 p-2">
              {loading ? (
                <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-slate-400"><LoaderCircle className="h-5 w-5 animate-spin" /> Loading OneDrive...</div>
              ) : items.length === 0 ? (
                <div className="flex min-h-56 items-center justify-center text-sm text-slate-400">No folders or PDF files found here.</div>
              ) : items.map((item) => {
                const driveId = item.parentReference?.driveId || '';
                const selection = { driveId, itemId: item.id, name: item.name, size: item.size };
                const isSelected = selected.some((entry) => entry.driveId === driveId && entry.itemId === item.id);
                return (
                  <button
                    className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-slate-800', isSelected && 'bg-violet-500/20 ring-1 ring-violet-400')}
                    key={`${driveId}-${item.id}`}
                    onClick={() => {
                      if (item.folder) {
                        void openFolder(item);
                        return;
                      }
                      setSelected((current) => (
                        current.some((entry) => entry.driveId === driveId && entry.itemId === item.id)
                          ? current.filter((entry) => !(entry.driveId === driveId && entry.itemId === item.id))
                          : [...current, selection]
                      ));
                    }}
                    type="button"
                  >
                    {item.folder ? <Folder className="h-5 w-5 shrink-0 text-amber-300" /> : <FileText className="h-5 w-5 shrink-0 text-rose-300" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-100">{item.name}</p>
                      <p className="text-xs text-slate-500">{item.folder ? `${item.folder.childCount ?? 0} items` : formatBytes(item.size)}</p>
                    </div>
                    {!item.folder && isSelected ? <Check className="h-4 w-4 text-violet-300" /> : null}
                    {item.folder ? <ChevronRight className="h-4 w-4 text-slate-500" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {error ? <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">Cancel</Button>
          {accessToken ? (
            <Button disabled={selected.length === 0 || importing} onClick={() => void handleImport()} type="button">
              {importing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
              {importing ? 'Starting import...' : `Import ${selected.length === 1 ? 'selected PDF' : `${selected.length} selected PDFs`}`}
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
