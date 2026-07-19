import {
  CampaignCalculationResponse,
  CampaignEditLockInfo,
  CampaignListItem,
  CampaignPrintImage,
  CampaignRecord,
  CampaignSupportingDocument,
  CampaignSubmitResponse,
  CampaignUpsertPayload,
} from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

function withTenant(path: string, tenantId?: string | null) {
  if (!tenantId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}

export async function fetchCampaigns(tenantId?: string | null) {
  return apiFetchJson<{ campaigns: CampaignListItem[] }>(withTenant('/api/campaigns', tenantId));
}

export async function createCampaign(payload: CampaignUpsertPayload, tenantId?: string | null) {
  return apiFetchJson<{ campaign: CampaignRecord }>(withTenant('/api/campaigns', tenantId), {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createSubCampaign(campaignId: string, tenantId?: string | null) {
  return apiFetchJson<{ campaign: CampaignRecord }>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}/sub-campaigns`, tenantId), {
    method: 'POST',
  });
}

export async function fetchCampaign(campaignId: string, tenantId?: string | null) {
  return apiFetchJson<{ campaign: CampaignRecord }>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}`, tenantId));
}

export async function deleteCampaign(campaignId: string, tenantId?: string | null) {
  return apiFetchJson<{ deleted: boolean }>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}`, tenantId), {
    method: 'DELETE',
  });
}

export async function updateCampaign(campaignId: string, payload: CampaignUpsertPayload, tenantId?: string | null) {
  return apiFetchJson<{ campaign: CampaignRecord }>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}`, tenantId), {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function appendCampaignPrintImages(campaignId: string, images: CampaignPrintImage[], tenantId?: string | null) {
  return apiFetchJson<{ campaign: CampaignRecord }>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}/print-images`, tenantId), {
    method: 'POST',
    body: JSON.stringify({ images }),
  });
}

export async function appendCampaignSupportingDocuments(
  campaignId: string,
  documents: CampaignSupportingDocument[],
  tenantId?: string | null,
) {
  return apiFetchJson<{ campaign: CampaignRecord }>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}/supporting-documents`, tenantId), {
    method: 'POST',
    body: JSON.stringify({ documents }),
  });
}

export async function calculatePersistedCampaign(campaignId: string, tenantId?: string | null) {
  return apiFetchJson<CampaignCalculationResponse>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}/calculate`, tenantId), {
    method: 'POST',
  });
}

export async function submitCampaignToPrintIQ(campaignId: string, tenantId?: string | null) {
  return apiFetchJson<CampaignSubmitResponse>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}/submit-to-printiq`, tenantId), {
    method: 'POST',
  });
}

export async function markCampaignSubmitted(campaignId: string, tenantId?: string | null) {
  return apiFetchJson<{ campaign: CampaignRecord }>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}/mark-submitted`, tenantId), {
    method: 'POST',
  });
}

export async function acquireCampaignEditLock(campaignId: string, tenantId?: string | null) {
  return apiFetchJson<{ lock: CampaignEditLockInfo }>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}/edit-lock`, tenantId), {
    method: 'POST',
  });
}

export async function releaseCampaignEditLock(campaignId: string, tenantId?: string | null) {
  return apiFetchJson<{ released: boolean }>(withTenant(`/api/campaigns/${encodeURIComponent(campaignId)}/edit-lock`, tenantId), {
    method: 'DELETE',
  });
}
