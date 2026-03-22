import { PrintIqQuotePayload } from '../types';
import { apiFetchJson } from './apiClient';

export type QuotePricingResponse = {
  amount: number | string | null;
};

export async function submitQuoteForPricing(payload: PrintIqQuotePayload) {
  return apiFetchJson<QuotePricingResponse>('/api/quotes/price', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
