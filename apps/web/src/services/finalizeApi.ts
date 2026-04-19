import { buildApiUrl } from './apiBase';
import { getApiAuthToken } from './apiClient';

type SendEmailToAdsResponse = {
  message: string;
};

export type CreativeEmailLink = {
  name: string;
  url: string;
};

export async function sendEmailToAds(files: File[], campaignName?: string, creativeLinks: CreativeEmailLink[] = []): Promise<SendEmailToAdsResponse> {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file, file.name);
  });
  if (campaignName?.trim()) {
    formData.append('campaignName', campaignName.trim());
  }
  if (creativeLinks.length > 0) {
    formData.append('creativeLinks', JSON.stringify(creativeLinks));
  }

  const headers = new Headers();
  const authToken = getApiAuthToken();
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const response = await fetch(buildApiUrl('/api/finalize/send-email-to-ads'), {
    method: 'POST',
    headers,
    body: formData,
  });

  const responseText = await response.text();
  const body = responseText
    ? (() => {
        try {
          return JSON.parse(responseText);
        } catch {
          return responseText;
        }
      })()
    : null;

  if (!response.ok) {
    const message =
      typeof body === 'object' && body && 'error' in body
        ? String(body.error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body as SendEmailToAdsResponse;
}
