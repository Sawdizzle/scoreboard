import type { MetadataRoute } from 'next';

// Added to a phone's home screen, Scoreboard opens on your teams, full screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Scoreboard',
    short_name: 'Scoreboard',
    start_url: '/t',
    display: 'standalone',
    orientation: 'any',
    background_color: '#0b1018',
    theme_color: '#0b1018',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      // The same art drawn inside Android's safe zone, for icons cut to a circle or squircle.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
