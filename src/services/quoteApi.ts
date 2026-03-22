import { PrintIqQuotePayload } from '../types';
import { buildApiUrl } from './apiBase';

export async function submitQuoteForPricing(payload: PrintIqQuotePayload) {
  const response = await fetch(buildApiUrl('/api/quotes/price'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body?.error || 'Unable to create PrintIQ quote');
  }

  return body;
}
