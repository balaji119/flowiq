import { buildApiUrl } from './apiBase';
import { getApiAuthToken } from './apiClient';

export type PurchaseOrderUploadResponse = {
  originalName: string;
  storedName: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
};

function withTenant(path: string, tenantId?: string | null) {
  if (!tenantId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}

export async function uploadPurchaseOrderFile(file: File, campaignId?: string, tenantId?: string | null): Promise<PurchaseOrderUploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (campaignId) {
    formData.append('campaignId', campaignId);
  }

  const headers = new Headers();
  const token = getApiAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(buildApiUrl(withTenant('/api/purchase-orders/upload', tenantId)), {
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
    const errorMessage =
      typeof payload === 'object' && payload && 'error' in payload ? String(payload.error) : `Upload failed (${response.status})`;
    throw new Error(errorMessage);
  }

  return payload as PurchaseOrderUploadResponse;
}
