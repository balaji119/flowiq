import { SheetNameOverrideRecord } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

function withTenant(path: string, tenantId?: string | null) {
  if (!tenantId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}

export async function fetchCampaignSheetNameOverrides(tenantId?: string | null) {
  return apiFetchJson<{ settings: SheetNameOverrideRecord }>(withTenant('/api/sheet-name-overrides', tenantId));
}
