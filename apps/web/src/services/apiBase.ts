const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';

export function buildApiUrl(path: string) {
  const normalizedPath = path.trim();
  if (!normalizedPath) return '';

  // Some persisted records can already contain an absolute URL.
  // In that case we must not prepend any API base.
  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  const pathWithLeadingSlash = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;

  if (!configuredApiBaseUrl) {
    // In local development, direct API calls avoid Next.js rewrite proxy limits
    // for larger multipart uploads (e.g. large PDFs).
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      return `http://localhost:4000${pathWithLeadingSlash}`;
    }
    return pathWithLeadingSlash;
  }

  const resolvedApiBaseUrl = configuredApiBaseUrl.replace(/\/+$/, '');
  const baseUrl = resolvedApiBaseUrl.endsWith('/api')
    ? resolvedApiBaseUrl.slice(0, -4)
    : resolvedApiBaseUrl;

  return `${baseUrl}${pathWithLeadingSlash}`;
}
