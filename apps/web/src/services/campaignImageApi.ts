import { buildApiUrl } from './apiBase';
import { getApiAuthToken } from './apiClient';

export type CampaignImageUploadResponse = {
  originalName: string;
  storedName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  url?: string;
};

type ResumableUploadMetadata = {
  uploadId: string;
  chunkSize: number;
  chunkCount: number;
  size: number;
};

function authenticatedHeaders(contentType?: string) {
  const headers = new Headers();
  const token = getApiAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (contentType) headers.set('Content-Type', contentType);
  return headers;
}

async function readUploadResponse(response: Response) {
  const text = await response.text();
  const payload = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })()
    : null;
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? String(payload.error)
      : `Upload failed (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

export async function uploadCampaignImage(file: File): Promise<CampaignImageUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const headers = new Headers();
  const token = getApiAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(buildApiUrl('/api/campaign-images/upload'), {
    method: 'POST',
    headers,
    body: formData,
  });

  const text = await response.text();
  const payload = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })()
    : null;

  if (!response.ok) {
    const errorMessage = typeof payload === 'object' && payload && 'error' in payload ? String(payload.error) : `Upload failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return payload as CampaignImageUploadResponse;
}

export async function uploadCampaignImageResumable(
  file: File,
  onProgress?: (uploadedBytes: number, totalBytes: number) => void,
  onPhaseChange?: (phase: 'uploading' | 'finalizing') => void,
): Promise<CampaignImageUploadResponse> {
  onPhaseChange?.('uploading');
  const resumeKey = `flowiq:resumable-upload:${file.name}:${file.size}:${file.lastModified}`;
  let savedUploadId = '';
  try {
    savedUploadId = window.localStorage.getItem(resumeKey) || '';
  } catch {
    // Resume metadata is best-effort; the active upload still continues.
  }

  let upload: ResumableUploadMetadata | null = null;
  let receivedChunks: number[] = [];
  if (savedUploadId) {
    const statusResponse = await fetch(buildApiUrl(`/api/campaign-image-uploads/${encodeURIComponent(savedUploadId)}`), {
      headers: authenticatedHeaders(),
    });
    if (statusResponse.ok) {
      const status = await readUploadResponse(statusResponse) as { upload: ResumableUploadMetadata; receivedChunks: number[] };
      upload = status.upload;
      receivedChunks = status.receivedChunks ?? [];
    } else if (statusResponse.status !== 404) {
      await readUploadResponse(statusResponse);
    }
  }

  if (!upload) {
    const initResponse = await fetch(buildApiUrl('/api/campaign-image-uploads/init'), {
      method: 'POST',
      headers: authenticatedHeaders('application/json'),
      body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/pdf', size: file.size }),
    });
    upload = await readUploadResponse(initResponse) as ResumableUploadMetadata;
    try {
      window.localStorage.setItem(resumeKey, upload.uploadId);
    } catch {
      // Resume metadata is best-effort.
    }
  }

  const receivedSet = new Set(receivedChunks);
  let uploadedBytes = receivedChunks.reduce((total, index) => {
    const start = index * upload!.chunkSize;
    return total + Math.min(upload!.chunkSize, upload!.size - start);
  }, 0);
  onProgress?.(uploadedBytes, file.size);
  const missingChunks = Array.from({ length: upload.chunkCount }, (_, index) => index).filter((index) => !receivedSet.has(index));
  let cursor = 0;

  async function uploadChunk(index: number) {
    const start = index * upload!.chunkSize;
    const end = Math.min(file.size, start + upload!.chunkSize);
    const chunk = file.slice(start, end);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(
          buildApiUrl(`/api/campaign-image-uploads/${encodeURIComponent(upload!.uploadId)}/chunks/${index}`),
          { method: 'PUT', headers: authenticatedHeaders('application/octet-stream'), body: chunk },
        );
        await readUploadResponse(response);
        uploadedBytes += chunk.size;
        onProgress?.(uploadedBytes, file.size);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Unable to upload chunk ${index + 1}`);
  }

  async function worker() {
    while (cursor < missingChunks.length) {
      const index = missingChunks[cursor];
      cursor += 1;
      await uploadChunk(index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, missingChunks.length) }, () => worker()));

  onPhaseChange?.('finalizing');
  const completeResponse = await fetch(
    buildApiUrl(`/api/campaign-image-uploads/${encodeURIComponent(upload.uploadId)}/complete`),
    { method: 'POST', headers: authenticatedHeaders('application/json'), body: '{}' },
  );
  const completed = await readUploadResponse(completeResponse) as CampaignImageUploadResponse;
  try {
    window.localStorage.removeItem(resumeKey);
  } catch {
    // Best effort only.
  }
  onProgress?.(file.size, file.size);
  return completed;
}

export async function deleteCampaignImage(storedName: string): Promise<{ deleted: boolean }> {
  const normalizedStoredName = storedName.trim();
  if (!normalizedStoredName) {
    throw new Error('Missing stored image name');
  }

  const headers = new Headers();
  const token = getApiAuthToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(buildApiUrl(`/api/campaign-images/${encodeURIComponent(normalizedStoredName)}`), {
    method: 'DELETE',
    headers,
  });

  const text = await response.text();
  const payload = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      })()
    : null;

  if (!response.ok) {
    const errorMessage = typeof payload === 'object' && payload && 'error' in payload ? String(payload.error) : `Delete failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return (payload as { deleted: boolean }) ?? { deleted: true };
}
