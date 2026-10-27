'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Where a team lives. For staff: today, the calendar, the team's messages, the
// people and the season; Roster, People, Opponents, the team's own settings
// and its stream are all "Team". A parent or fan has Home, the calendar and
// the messages (a fan's Chat is the league's and team's announcements only).
// `at` overrides the address, for the component sheet at /dev/kit.
export function TabBar({ slug, at, member }: { slug: string; at?: string; member?: boolean }) {
  const here = usePathname();
  const path = at ?? here;
  const base = `/t/${slug}`;
  // The Team tab's own sections, listed under it only in the sidebar.
  const subs = [['roster', 'Roster'], ['people', 'People'], ['stats', 'Stats'], ['opponents', 'Opponents'], ['settings', 'Team settings'], ['stream', 'Stream']].map(([p, label]) => (
    { href: `${base}/${p}`, label, on: path.startsWith(`${base}/${p}`) || (p === 'roster' && path.startsWith(`${base}/player`)) }));
  const shared = [
    { href: `${base}/calendar`, label: 'Calendar', on: path.startsWith(`${base}/calendar`) },
    { href: `${base}/chat`, label: 'Chat', on: path.startsWith(`${base}/chat`) },
  ];
  const tabs: { href: string; label: string; on: boolean; subs?: typeof subs }[] = member ? [
    { href: base, label: 'Home', on: path === base || path.startsWith(`${base}/player`) },
    ...shared,
  ] : [
    { href: base, label: 'Today', on: path === base || path.startsWith(`${base}/games`) },
    ...shared,
    { href: `${base}/roster`, label: 'Team', on: ['/roster', '/people', '/stats', '/opponents', '/settings', '/stream', '/player'].some((p) => path.startsWith(base + p)), subs },
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

export function TeamTabs({ slug, players, opponents, people = 0, at }: { slug: string; players: number; opponents: number; people?: number; at?: string }) {
  const here = usePathname();
  const path = at ?? here;
  const base = `/t/${slug}`;
  const tabs = [
    { href: `${base}/roster`, label: `Roster · ${players}`, on: path.startsWith(`${base}/roster`) },
    { href: `${base}/people`, label: people ? `People · ${people} waiting` : 'People', on: path.startsWith(`${base}/people`) },
    { href: `${base}/stats`, label: 'Stats', on: path.startsWith(`${base}/stats`) },
    { href: `${base}/opponents`, label: `Opponents · ${opponents}`, on: path.startsWith(`${base}/opponents`) },
    { href: `${base}/settings`, label: 'Team', on: path.startsWith(`${base}/settings`) },
    { href: `${base}/stream`, label: 'Stream', on: path.startsWith(`${base}/stream`) },
  ];
  // With the sidebar showing these sections, the screen gets a title instead of the switch.
  const title = ['Roster', 'People', 'Stats', 'Opponents', 'Team settings', 'Stream'][tabs.findIndex((t) => t.on)];
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
