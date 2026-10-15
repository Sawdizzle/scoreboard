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
