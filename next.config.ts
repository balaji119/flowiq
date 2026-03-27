import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  output: 'export',
  outputFileTracingRoot: path.join(__dirname),
  transpilePackages: ['react-native', 'react-native-web'],
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      'react-native$': 'react-native-web',
    };

    config.resolve.extensions = [
      '.web.ts',
      '.web.tsx',
      '.web.js',
      '.web.jsx',
      ...(config.resolve.extensions ?? []),
    ];

    return config;
  },
};

export default nextConfig;
