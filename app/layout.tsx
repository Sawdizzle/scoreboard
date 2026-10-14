import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed, Martian_Mono } from 'next/font/google';
import './globals.css';

// Three faces, self-hosted by next/font so nothing reaches a font CDN at
// runtime: Barlow Condensed for numerals and display (the scorebug's face),
// Barlow for reading, Martian Mono for the small caps labels.
const cond = Barlow_Condensed({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-cond', display: 'swap' });
const body = Barlow({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-body', display: 'swap' });
const mono = Martian_Mono({ subsets: ['latin'], weight: ['400', '600'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Pressbox', template: '%s · Pressbox' },
  description: 'Build the team once. Score the game once. The stats and the broadcast read from the same plays.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0b1018' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cond.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
