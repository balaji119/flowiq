import { PrintIqQuotePayload } from '../types';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export async function submitQuoteForPricing(payload: PrintIqQuotePayload) {
  const response = await fetch(`${apiBaseUrl}/api/quotes/price`, {
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
