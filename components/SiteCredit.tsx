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

// Screens that stay clean: the OBS overlay, the pad, a game as it is followed
// live, and the component sheet. A team's own screens (/t/<slug>/...) carry the
// line inside their frame instead, clear of the tab bar.
const BARE = /^\/(overlay|pad|dev)(\/|$)|^\/team\/[^/]+\/game\/|^\/t\/(?!new(\/|$))[^/]+(\/|$)/;

export function RootCredit() {
  const path = usePathname() ?? '';
  return BARE.test(path) ? null : <SiteCredit />;
}
