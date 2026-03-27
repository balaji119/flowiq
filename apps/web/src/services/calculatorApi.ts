import { CalculatorMetadataResponse, CampaignCalculationSummary, CampaignLine } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

export async function fetchCalculatorMetadata(): Promise<CalculatorMetadataResponse> {
  return apiFetchJson<CalculatorMetadataResponse>('/api/calculator/metadata');
}

export async function calculateCampaign(
  campaignLines: CampaignLine[],
): Promise<CampaignCalculationSummary> {
  return apiFetchJson<CampaignCalculationSummary>('/api/calculator/calculate', {
    method: 'POST',
    body: JSON.stringify({ campaignLines }),
  });
}
