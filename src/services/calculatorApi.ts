import { CalculatorMetadataResponse, CampaignCalculationSummary, CampaignLine } from '../types';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export async function fetchCalculatorMetadata(): Promise<CalculatorMetadataResponse> {
  const response = await fetch(`${apiBaseUrl}/api/calculator/metadata`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error || 'Unable to load calculator metadata');
  }

  return body;
}

export async function calculateCampaign(
  campaignLines: CampaignLine[],
): Promise<CampaignCalculationSummary> {
  const response = await fetch(`${apiBaseUrl}/api/calculator/calculate`, {
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
