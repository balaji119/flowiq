import { AccountInfo, PublicClientApplication } from '@azure/msal-browser';
import { CampaignPrintImage } from '@flowiq/shared';
import { apiFetchJson } from './apiClient';

const graphScopes = ['Files.Read'];

let msalPromise: Promise<PublicClientApplication> | null = null;
let configurationPromise: Promise<OneDriveConfiguration> | null = null;

export type OneDriveConfiguration = {
  enabled: boolean;
  clientId: string;
  tenantId: string;
};

export type OneDriveBrowserItem = {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  parentReference?: { driveId?: string };
};

export type OneDriveSelection = {
  driveId: string;
  itemId: string;
  name: string;
  size: number;
};

export type OneDriveImportJob = {
  id: string;
  campaignId: string;
  fileName: string;
  status: 'queued' | 'downloading' | 'processing' | 'saving' | 'completed' | 'error';
  downloadedBytes: number;
  totalBytes: number;
  processedPages: number;
  totalPages: number;
  images: CampaignPrintImage[];
  error?: string;
};

export function getOneDriveConfiguration() {
  if (!configurationPromise) {
    configurationPromise = apiFetchJson<OneDriveConfiguration>('/api/onedrive/config');
  }
  return configurationPromise;
}

async function getMsalClient() {
  const configuration = await getOneDriveConfiguration();
  if (!configuration.enabled || !configuration.clientId) throw new Error('OneDrive is not configured. Set ONEDRIVE_CLIENT_ID.');
  if (!msalPromise) {
    msalPromise = (async () => {
      const client = new PublicClientApplication({
        auth: {
          clientId: configuration.clientId,
          authority: `https://login.microsoftonline.com/${encodeURIComponent(configuration.tenantId || 'organizations')}`,
          redirectUri: `${window.location.origin}/redirect`,
        },
        cache: { cacheLocation: 'sessionStorage' },
      });
      await client.initialize();
      return client;
    })();
  }
  return msalPromise;
}

async function activeAccount(client: PublicClientApplication): Promise<AccountInfo | null> {
  return client.getActiveAccount() ?? client.getAllAccounts()[0] ?? null;
}

export async function connectOneDrive(overrideInteractionInProgress = false) {
  const client = await getMsalClient();
  const response = await client.loginPopup({
    scopes: graphScopes,
    prompt: 'select_account',
    overrideInteractionInProgress,
  });
  client.setActiveAccount(response.account);
  return response.accessToken;
}

export function oneDriveAuthErrorCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('errorCode' in error)) return '';
  return String(error.errorCode || '').trim().toLowerCase();
}

export async function acquireOneDriveAccessToken() {
  const client = await getMsalClient();
  const account = await activeAccount(client);
  if (!account) return connectOneDrive();
  try {
    const response = await client.acquireTokenSilent({ account, scopes: graphScopes });
    client.setActiveAccount(account);
    return response.accessToken;
  } catch {
    const response = await client.acquireTokenPopup({ account, scopes: graphScopes });
    client.setActiveAccount(response.account);
    return response.accessToken;
  }
}

async function graphJson<T>(accessToken: string, endpoint: string): Promise<T> {
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  const payload = await response.json().catch(() => null) as ({ error?: { message?: string } } & T) | null;
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OneDrive request failed (${response.status})`);
  }
  return payload as T;
}

export async function listOneDriveItems(accessToken: string, driveId?: string, folderId?: string) {
  const select = '$select=id,name,size,file,folder,parentReference,lastModifiedDateTime&$orderby=name&$top=200';
  let nextUrl = driveId && folderId
    ? `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folderId)}/children?${select}`
    : `https://graph.microsoft.com/v1.0/me/drive/root/children?${select}`;
  const items: OneDriveBrowserItem[] = [];
  while (nextUrl && items.length < 1000) {
    const page: { value?: OneDriveBrowserItem[]; '@odata.nextLink'?: string } = await graphJson(accessToken, nextUrl);
    items.push(...(page.value ?? []));
    nextUrl = page['@odata.nextLink'] || '';
  }
  return items.filter((item) => item.folder || item.name.toLowerCase().endsWith('.pdf'));
}

function withTenant(path: string, tenantId?: string | null) {
  if (!tenantId) return path;
  return `${path}?tenantId=${encodeURIComponent(tenantId)}`;
}

export async function createOneDriveArtworkImport(
  campaignId: string,
  tenantId: string | null | undefined,
  selection: OneDriveSelection,
  accessToken: string,
) {
  return apiFetchJson<{ import: OneDriveImportJob }>(withTenant('/api/onedrive-artwork-imports', tenantId), {
    method: 'POST',
    body: JSON.stringify({
      campaignId,
      driveId: selection.driveId,
      itemId: selection.itemId,
      accessToken,
    }),
  });
}

export async function fetchOneDriveArtworkImport(importId: string) {
  return apiFetchJson<{ import: OneDriveImportJob }>(`/api/onedrive-artwork-imports/${encodeURIComponent(importId)}`);
}
