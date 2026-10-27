import type { NextConfig } from 'next';

// Staff, pad and sign-in pages may never sit in someone else's frame. The
// stream overlay, the bugs and the spots stay frameable: OBS loads them as a
// Browser Source. The public team pages stay embeddable on a league's site.
const NO_FRAME = ['/', '/t', '/t/:path*', '/pad/:path*', '/sign-in', '/sign-up', '/forgot', '/reset', '/invite/:path*', '/join/:path*', '/org/:path*', '/auth/:path*', '/privacy'];
const NO_FRAME_HEADERS = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  { key: 'X-Frame-Options', value: 'DENY' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      ...NO_FRAME.map((source) => ({ source, headers: NO_FRAME_HEADERS })),
      // The service worker that shows push notifications: always the newest copy.
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
  // v4's pages, on the phone's home screen and in OBS. The query string comes
  // along, so /overlay.html?ch=... reaches the /overlay page that maps it.
  async redirects() {
    return [
      { source: '/control', destination: '/t', permanent: false },
      { source: '/control.html', destination: '/t', permanent: false },
      { source: '/index.html', destination: '/', permanent: false },
      { source: '/overlay.html', destination: '/overlay', permanent: false },
      { source: '/recap.html', destination: '/recap', permanent: false },
    ];
  },
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
