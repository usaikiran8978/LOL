import path from 'node:path';
import type { NextConfig } from 'next';

// The API origin is server-side only: the browser always talks to `/api/*` on the admin origin, so the
// `amora_admin` cookie is first-party and SameSite=Strict holds without any CORS configuration.
const apiUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle for the container image (apps/admin/Dockerfile).
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // `@amora/shared` is consumed as TypeScript source (see tsconfig paths) so admin never runs against a stale build.
  transpilePackages: ['@amora/shared'],
  turbopack: { root: path.join(__dirname, '../..') },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/v1/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
