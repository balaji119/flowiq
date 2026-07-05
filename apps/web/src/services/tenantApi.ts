import { TenantRecord } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

export async function fetchTenant(tenantId?: string | null) {
  const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  return apiFetchJson<{ tenant: TenantRecord }>(`/api/tenant${query}`);
}
