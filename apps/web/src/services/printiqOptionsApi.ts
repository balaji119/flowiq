import { PrintIqStockOption } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

export async function searchStockOptions(query: string): Promise<PrintIqStockOption[]> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set('q', query.trim());
  }

  return apiFetchJson<PrintIqStockOption[]>(`/api/printiq/options/stocks?${params.toString()}`);
}

export async function searchProcessOptions(query: string): Promise<Array<{ label: string; value: string }>> {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set('q', query.trim());
  }

  return apiFetchJson<Array<{ label: string; value: string }>>(`/api/printiq/options/processes?${params.toString()}`);
}
