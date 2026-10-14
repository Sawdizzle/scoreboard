'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Three places a team lives: today, the people, the season. Roster, Staff,
// the team's own settings and its stream are all "Team".
// `at` overrides the address, for the component sheet at /dev/kit.
export function TabBar({ slug, at }: { slug: string; at?: string }) {
  const here = usePathname();
  const path = at ?? here;
  const base = `/t/${slug}`;
  const tabs = [
    { href: base, label: 'Today', on: path === base },
    { href: `${base}/roster`, label: 'Team', on: ['/roster', '/staff', '/settings', '/stream', '/player'].some((p) => path.startsWith(base + p)) },
    { href: `${base}/season`, label: 'Season', on: path.startsWith(`${base}/season`) },
  ];
  return (
    <nav className="tabbar" aria-label="Team">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="tab" aria-current={t.on ? 'page' : undefined}>
          <span className="tab-mark" />
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function TeamTabs({ slug, players, staff, at }: { slug: string; players: number; staff: number; at?: string }) {
  const here = usePathname();
  const path = at ?? here;
  const base = `/t/${slug}`;
  const tabs = [
    { href: `${base}/roster`, label: `Roster · ${players}`, on: path.startsWith(`${base}/roster`) },
    { href: `${base}/staff`, label: `Staff · ${staff}/5`, on: path.startsWith(`${base}/staff`) },
    { href: `${base}/settings`, label: 'Team', on: path.startsWith(`${base}/settings`) },
    { href: `${base}/stream`, label: 'Stream', on: path.startsWith(`${base}/stream`) },
  ];
  return (
    <nav className="seg" aria-label="Team sections">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className="seg-item" aria-current={t.on ? 'page' : undefined}>{t.label}</Link>
      ))}
    </nav>
  );
}
