import { Platform } from 'react-native';

const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000';

function resolveMobileLocalhost(url: string) {
  if (Platform.OS !== 'android') {
    return url;
  }

  return url
    .replace('http://localhost:', 'http://10.0.2.2:')
    .replace('http://127.0.0.1:', 'http://10.0.2.2:');
}

export function buildApiUrl(path: string) {
  const resolvedApiBaseUrl = resolveMobileLocalhost(configuredApiBaseUrl).replace(/\/+$/, '');
  const baseUrl = resolvedApiBaseUrl.endsWith('/api')
    ? resolvedApiBaseUrl.slice(0, -4)
    : resolvedApiBaseUrl;

  return `${baseUrl}${path}`;
}
