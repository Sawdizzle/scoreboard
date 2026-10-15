import Link from 'next/link';
import { GamePlace } from '@/components/GamePlace';
import { Check, ChevronRight } from '@/components/icons';
import { leaders } from '@/components/StatTables';
import { Matchup, Readiness } from '@/components/GameBits';
import { Slab, brandOf } from '@/components/TeamBrand';
import { LocalTime } from '@/components/LocalTime';
import { staffName } from '@/lib/format';
import type { SeasonLine } from '@/lib/stats';
import { canEditTeam, canRunGames, type Game, type Lineup, type Player, type Role, type Season, type Side, type Team } from '@/lib/types';

// Today, before there is a game to put on it: what the team has, and what it
// still needs. The Tonight card takes the top of this screen once games exist.
export function TodayView({ team, role, players, opponents, season, stats = [], roster = [], game = null, lineups = {} }: {
  team: Team; role: Role; players: number; opponents: number; season?: Season; stats?: SeasonLine[]; roster?: Player[];
  game?: Game | null; lineups?: Partial<Record<Side, Lineup>>;
}) {
  const who = new Map(roster.map((p) => [p.id, p]));
  const top = leaders(stats);
  const base = `/t/${team.slug}`;
  const steps = [
    { href: `${base}/roster`, title: 'Roster', done: players >= 9,
      meta: players === 0 ? 'Add your players, or paste the list' : `${players} ${players === 1 ? 'player' : 'players'}${players < 9 ? ' · nine fills a lineup' : ''}` },
    { href: `${base}/opponents`, title: 'Opponents', done: opponents > 0,
      meta: opponents ? `${opponents} ${opponents === 1 ? 'team' : 'teams'} you play` : 'Add the teams you play: logo, colours, roster' },
    { href: `${base}/season`, title: 'Season', done: !!season,
      meta: season ? season.name : 'Name the season the stats will count for' },
  ];
  return (
    <div className="page wide today" style={{ paddingTop: 10 }}>
      <h1 className="wide-title disp">Today</h1>
      {game ? (
        <section className="card next-game">
          <div className="next-top">
            <span className="eyebrow gold">{game.status === 'live' ? 'Live now' : <LocalTime iso={game.starts_at} />}</span>
            <span className="sub">{game.venue}</span>
          </div>
          <Matchup team={team} game={game} />
          <GamePlace game={game} compact />
          <div className="next-foot">
            {game.sport === 'baseball' ? <Readiness lineup={lineups.us} /> : <span className="sub">Score only</span>}
            <div className="btn-row">
              <Link href={`/pad/${team.slug}/${game.id}`} className="btn btn-primary">{game.status === 'live' ? 'Back to the pad' : 'Open the pad'}</Link>
              {game.sport === 'baseball' && <Link href={`${base}/games/${game.id}/lineup`} className="btn btn-quiet">Lineup</Link>}
            </div>
          </div>
        </section>
      ) : (
        <section className="card next-game">
          <div className="next-top">
            <span className="eyebrow gold">Next game</span>
            <span className="sub">{season?.name}</span>
          </div>
          <Slab brand={brandOf(team)} sub={`${team.name}${team.age_group ? ` ${team.age_group}` : ''}`} />
          <div className="next-foot">
            <p className="sub">Nothing on the schedule.</p>
            {canRunGames(role) && <Link href={`${base}/games/new`} className="btn btn-primary">New game</Link>}
          </div>
        </section>
      )}

      {top.length > 0 && (
        <section className="leaders">
          <div className="h-row" style={{ padding: '2px 4px 2px' }}>
            <h2 className="h-sec">Team leaders</h2>
            <Link href={`${base}/season`} className="link">Full stats</Link>
          </div>
          <div className="rows">
            {top.map(({ k, best, show }) => {
              const p = who.get(best.s.player_id);
              return (
                <Link key={k} href={`${base}/player/${best.s.player_id}`} className="row">
                  <span className="leader-k">{k}</span>
                  <span className="jersey" style={{ flexBasis: 34, fontSize: 24 }}>{p?.number || '–'}</span>
                  <span className="row-main"><span className="row-title">{p ? staffName(p, team.name_format) : 'Player'}</span></span>
                  <span className="leader-v">{show(best.v)}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="setup">
        <div className="h-row" style={{ padding: '2px 4px 6px' }}>
          <h2 className="h-sec">Team setup</h2>
          {!canEditTeam(role) && <span className="sub">View only for your seat</span>}
        </div>
        <div className="rows">
          {steps.map((s) => (
            <Link key={s.href} href={s.href} className="row">
              <span className="row-main">
                <span className="row-title">{s.title}</span>
                <span className="row-meta">{s.meta}</span>
              </span>
              {s.done ? <span className="done"><Check /> Set</span> : <span className="todo">To do</span>}
              <span className="chev"><ChevronRight /></span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
