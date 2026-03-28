import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@flowiq/shared', '@flowiq/ui'],
  async rewrites() {
    const configuredApiBaseUrl =
      process.env.API_PROXY_TARGET?.trim() ||
      process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
      'http://localhost:4000';
    const normalizedApiBaseUrl = configuredApiBaseUrl.replace(/\/+$/, '');

    return [
      {
        source: '/api/:path*',
        destination: `${normalizedApiBaseUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
