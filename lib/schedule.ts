import type { Game } from './types.ts';

// The season schedule in two parts: games still to play (live and scheduled,
// in the order given, which is soonest first) and games already final, most
// recent first. Final games with no time go last.
export function splitSchedule(games: Game[]) {
  const upcoming = games.filter((g) => g.status !== 'final');
  const completed = games.filter((g) => g.status === 'final').sort((a, b) => {
    if (!a.starts_at || !b.starts_at) return a.starts_at ? -1 : b.starts_at ? 1 : 0;
    return Date.parse(b.starts_at) - Date.parse(a.starts_at);
  });
  return { upcoming, completed };
}

// What Today shows: every game being played, then the next game day's games
// (a doubleheader or a tournament Saturday is two or three, each with its own
// lineup to set), at most four. A game day is the games within 14 hours of the
// first one. A game still marked live long after it started was almost
// certainly over and never ended on the pad: `stale` says so, and it no
// longer hides the games after it.
export const STALE_LIVE_MS = 8 * 3600 * 1000;
export function gameDay(games: Game[], now = Date.now()) {
  const stale = (g: Game) => g.status === 'live' && !!g.starts_at && now - Date.parse(g.starts_at) > STALE_LIVE_MS;
  const live = games.filter((g) => g.status === 'live');
  const dayAgo = now - 12 * 3600 * 1000;
  const ahead = games.filter((g) => g.status !== 'final' && g.status !== 'live' && (!g.starts_at || Date.parse(g.starts_at) >= dayAgo));
  const first = ahead[0];
  const day = !first ? [] : !first.starts_at ? [first]
    : ahead.filter((g) => g.starts_at && Date.parse(g.starts_at) - Date.parse(first.starts_at!) < 14 * 3600 * 1000);
  return [...live.filter((g) => !stale(g)), ...day, ...live.filter(stale)].slice(0, 4).map((g) => ({ game: g, stale: stale(g) }));
}
