import {
  CampaignCalculationResponse,
  CampaignRecord,
  CampaignSubmitResponse,
  CampaignUpsertPayload,
} from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

export async function createCampaign(payload: CampaignUpsertPayload) {
  return apiFetchJson<{ campaign: CampaignRecord }>('/api/campaigns', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchCampaign(campaignId: string) {
  return apiFetchJson<{ campaign: CampaignRecord }>(`/api/campaigns/${encodeURIComponent(campaignId)}`);
}

export async function updateCampaign(campaignId: string, payload: CampaignUpsertPayload) {
  return apiFetchJson<{ campaign: CampaignRecord }>(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function calculatePersistedCampaign(campaignId: string) {
  return apiFetchJson<CampaignCalculationResponse>(`/api/campaigns/${encodeURIComponent(campaignId)}/calculate`, {
    method: 'POST',
  });
}

export async function submitCampaignToPrintIQ(campaignId: string) {
  return apiFetchJson<CampaignSubmitResponse>(`/api/campaigns/${encodeURIComponent(campaignId)}/submit-to-printiq`, {
    method: 'POST',
  });
}
