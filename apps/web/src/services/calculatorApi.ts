import { CalculatorMetadataResponse, CampaignCalculationSummary, CampaignLine } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

function withTenant(path: string, tenantId?: string | null) {
  if (!tenantId) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}tenantId=${encodeURIComponent(tenantId)}`;
}

export async function fetchCalculatorMetadata(tenantId?: string | null): Promise<CalculatorMetadataResponse> {
  return apiFetchJson<CalculatorMetadataResponse>(withTenant('/api/calculator/metadata', tenantId));
}

export async function calculateCampaign(
  campaignLines: CampaignLine[],
  tenantId?: string | null,
): Promise<CampaignCalculationSummary> {
  return apiFetchJson<CampaignCalculationSummary>(withTenant('/api/calculator/calculate', tenantId), {
    method: 'POST',
    body: JSON.stringify({ campaignLines }),
  });
}
