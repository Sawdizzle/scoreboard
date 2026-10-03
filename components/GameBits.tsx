import Link from 'next/link';
import { Check, ChevronRight } from '@/components/icons';
import { LocalTime } from '@/components/LocalTime';
import { lineupStatus } from '@/lib/lineup';
import type { Game, Lineup } from '@/lib/types';

export { Matchup } from '@/components/TeamBrand';

// "Lineup 9/9 · Field 9/9", or what is still missing.
export function Readiness({ lineup, label = 'Lineup' }: { lineup?: Lineup; label?: string }) {
  const s = lineupStatus(lineup);
  const field = 9 - s.missing.length;
  return (
    <div className="chips">
      {s.batters >= 9 ? <span className="done"><Check /> {label} {s.batters}</span> : <span className="todo">{label} {s.batters}/9</span>}
      {field === 9 ? <span className="done"><Check /> Field 9/9</span> : <span className="todo">Field {field}/9</span>}
    </div>
  );
}

export function ScheduleList({ slug, games }: { slug: string; games: Game[] }) {
  return (
    <div className="rows">
      {games.map((g) => (
        <Link key={g.id} href={`/t/${slug}/games/${g.id}`} className="game-row">
          <span className="game-when">
            <LocalTime iso={g.starts_at} mode="day" />
            <LocalTime iso={g.starts_at} mode="time" />
          </span>
          <span className="row-main">
            <span className="row-title">{g.is_home ? 'vs' : 'at'} {g.opponent_name}</span>
            <span className="row-meta">{[g.venue, g.status === 'live' ? 'Live now' : g.status === 'final' ? 'Final' : null, g.counts_for_stats ? null : 'Scrimmage'].filter(Boolean).join(' · ') || ' '}</span>
          </span>
          <span className="chev"><ChevronRight /></span>
        </Link>
      ))}
    </div>
  );
}

// The game to put on Today: one being played, else the next one not yet
// final (a game from earlier today still counts until it is marked final).
export function nextGame(games: Game[], now = Date.now()) {
  const live = games.find((g) => g.status === 'live');
  if (live) return live;
  const dayAgo = now - 12 * 3600 * 1000;
  return games.find((g) => g.status !== 'final' && (!g.starts_at || Date.parse(g.starts_at) >= dayAgo)) ?? null;
}
