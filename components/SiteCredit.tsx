'use client';

import { usePathname } from 'next/navigation';

// The maker's line at the foot of the page, small and in the label colour.
export function SiteCredit() {
  return (
    <footer className="site-credit">
      A product solution by{' '}
      <a href="https://sawtechsolutions.com" target="_blank" rel="noopener">Saw Tech Solutions, LLC</a>
    </footer>
  );
}

// Only the public website pages carry the line: the front page and the
// privacy page. The app itself (sign-in, teams, the pad, overlays) stays clean.
const SITE = /^\/(privacy)?$/;

export function RootCredit() {
  const path = usePathname() ?? '';
  return SITE.test(path) ? <SiteCredit /> : null;
}
