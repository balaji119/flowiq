import { CalculatorMetadataResponse, CampaignCalculationSummary, CampaignLine } from '../types';
import { buildApiUrl } from './apiBase';

export async function fetchCalculatorMetadata(): Promise<CalculatorMetadataResponse> {
  const response = await fetch(buildApiUrl('/api/calculator/metadata'));
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error || 'Unable to load calculator metadata');
  }

  return body;
}

export async function calculateCampaign(
  campaignLines: CampaignLine[],
): Promise<CampaignCalculationSummary> {
  const response = await fetch(buildApiUrl('/api/calculator/calculate'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ campaignLines }),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error || 'Unable to calculate campaign quantities');
  }

  return body;
}
