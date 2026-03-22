import { AuthRole, AuthUser, PrintIqOptionsCacheStatus, TenantRecord } from '../types';
import { apiFetchJson } from './apiClient';

export async function fetchTenants() {
  return apiFetchJson<{ tenants: TenantRecord[] }>('/api/admin/tenants');
}

export async function createTenant(payload: { name: string; slug?: string }) {
  return apiFetchJson<{ tenant: TenantRecord }>('/api/admin/tenants', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchUsers(tenantId?: string) {
  const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  return apiFetchJson<{ users: AuthUser[] }>(`/api/admin/users${query}`);
}

export async function createUser(payload: {
  name: string;
  email: string;
  password: string;
  role: AuthRole;
  tenantId?: string | null;
}) {
  return apiFetchJson<{ user: AuthUser }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateUser(
  userId: string,
  payload: {
    name?: string;
    password?: string;
    role?: AuthRole;
    active?: boolean;
    tenantId?: string | null;
  },
) {
  return apiFetchJson<{ user: AuthUser }>(`/api/admin/users/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function fetchPrintIqOptionsStatus() {
  return apiFetchJson<PrintIqOptionsCacheStatus>('/api/admin/printiq-options/status');
}

export async function refreshPrintIqOptionsCache() {
  return apiFetchJson<
    {
      message: string;
      stocks: { count: number; updatedAt: string | null };
      processes: { count: number; updatedAt: string | null };
    }
  >('/api/admin/printiq-options/refresh', {
    method: 'POST',
  });
}
