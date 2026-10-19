'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Three places a team lives: today, the people, the season. Roster, Opponents,
// the team's own settings and its stream are all "Team".
// `at` overrides the address, for the component sheet at /dev/kit.
export function TabBar({ slug, at }: { slug: string; at?: string }) {
  const here = usePathname();
  const path = at ?? here;
  const base = `/t/${slug}`;
  // The Team tab's own sections, listed under it only in the sidebar.
  const subs = [['roster', 'Roster'], ['stats', 'Stats'], ['opponents', 'Opponents'], ['settings', 'Team settings'], ['stream', 'Stream']].map(([p, label]) => (
    { href: `${base}/${p}`, label, on: path.startsWith(`${base}/${p}`) || (p === 'roster' && path.startsWith(`${base}/player`)) }));
  const tabs = [
    { href: base, label: 'Today', on: path === base || path.startsWith(`${base}/games`) },
    { href: `${base}/roster`, label: 'Team', on: ['/roster', '/stats', '/opponents', '/settings', '/stream', '/player'].some((p) => path.startsWith(base + p)), subs },
    { href: `${base}/season`, label: 'Season', on: path.startsWith(`${base}/season`) },
  ];
  // The lineup screen keeps its own bar at the bottom (save, Undo, the pad):
  // on a phone the tabs step aside so a thumb cannot leave it by mistake.
  const away = /\/games\/[^/]+\/lineup/.test(path);
  return (
    <nav className={`tabbar${away ? ' away' : ''}`} aria-label="Team">
      {tabs.map((t) => (
        <div key={t.href} className="tab-group">
          <Link href={t.href} className="tab" aria-current={t.on && !t.subs?.some((x) => x.on) ? 'page' : t.on ? 'true' : undefined}>
            <span className="tab-mark" />
            {t.label}
          </Link>
          {t.subs && (
            <div className="tab-subs">
              {t.subs.map((x) => <Link key={x.href} href={x.href} className="tab-sub" aria-current={x.on ? 'page' : undefined}>{x.label}</Link>)}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

export function TeamTabs({ slug, players, opponents, at }: { slug: string; players: number; opponents: number; at?: string }) {
  const here = usePathname();
  const path = at ?? here;
  const base = `/t/${slug}`;
  const tabs = [
    { href: `${base}/roster`, label: `Roster · ${players}`, on: path.startsWith(`${base}/roster`) },
    { href: `${base}/stats`, label: 'Stats', on: path.startsWith(`${base}/stats`) },
    { href: `${base}/opponents`, label: `Opponents · ${opponents}`, on: path.startsWith(`${base}/opponents`) },
    { href: `${base}/settings`, label: 'Team', on: path.startsWith(`${base}/settings`) },
    { href: `${base}/stream`, label: 'Stream', on: path.startsWith(`${base}/stream`) },
  ];
  // With the sidebar showing these sections, the screen gets a title instead of the switch.
  const title = ['Roster', 'Stats', 'Opponents', 'Team settings', 'Stream'][tabs.findIndex((t) => t.on)];
  return (
    <>
      {title && <h1 className="seg-title disp">{title}</h1>}
      <nav className="seg" aria-label="Team sections">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} className="seg-item" aria-current={t.on ? 'page' : undefined}>{t.label}</Link>
        ))}
      </nav>
    </>
  );
}
