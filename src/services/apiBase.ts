const configuredApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:4000';

export function buildApiUrl(path: string) {
  const resolvedApiBaseUrl = configuredApiBaseUrl.replace(/\/+$/, '');
  const baseUrl = resolvedApiBaseUrl.endsWith('/api')
    ? resolvedApiBaseUrl.slice(0, -4)
    : resolvedApiBaseUrl;

  return `${baseUrl}${path}`;
}
