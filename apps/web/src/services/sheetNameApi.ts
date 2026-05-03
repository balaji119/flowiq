import { SheetNameOverrideRecord } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

export async function fetchCampaignSheetNameOverrides() {
  return apiFetchJson<{ settings: SheetNameOverrideRecord }>('/api/sheet-name-overrides');
}
