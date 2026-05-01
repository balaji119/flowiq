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
