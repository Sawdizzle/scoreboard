import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The animated bugs and the on-air spots are static pages in public/. Up to
  // v4.47 they were served with clean URLs (/bugs/primetime, /ads/runtheplay),
  // and those links live in OBS scenes and old posts, so they keep working.
  async rewrites() {
    return [
      { source: '/bugs', destination: '/bugs/index.html' },
      { source: '/bugs/:slug([a-z0-9-]+)', destination: '/bugs/:slug.html' },
      { source: '/ads/:slug([a-z0-9-]+)', destination: '/ads/:slug.html' },
    ];
  },
};

export default nextConfig;
