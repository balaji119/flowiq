const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';

export function buildApiUrl(path: string) {
  if (!configuredApiBaseUrl) {
    return path;
  }

  const resolvedApiBaseUrl = configuredApiBaseUrl.replace(/\/+$/, '');
  const baseUrl = resolvedApiBaseUrl.endsWith('/api')
    ? resolvedApiBaseUrl.slice(0, -4)
    : resolvedApiBaseUrl;

  return `${baseUrl}${path}`;
}
