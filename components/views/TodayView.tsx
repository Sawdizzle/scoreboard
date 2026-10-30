import Link from 'next/link';
import { GamePlace } from '@/components/GamePlace';
import { Check, ChevronRight } from '@/components/icons';
import { NotifyCard, type NotifyPrefs } from '@/components/hub/NotifyCard';
import { leaders } from '@/components/StatTables';
import { Matchup, Readiness } from '@/components/GameBits';
import { Slab, brandOf } from '@/components/TeamBrand';
import { LocalTime } from '@/components/LocalTime';
import { staffName } from '@/lib/format';
import type { SeasonLine } from '@/lib/stats';
import { canBroadcast, canEditTeam, canMakeGames, canRunGames, canSeeTeam, type Game, type Lineup, type Player, type Role, type Season, type Side, type Team } from '@/lib/types';

// Today, before there is a game to put on it: what the team has, and what it
// still needs. The Tonight card takes the top of this screen once games exist.
export function TodayView({ team, role, players, opponents, season, stats = [], roster = [], day = [], prefs, me }: {
  team: Team; role: Role; players: number; opponents: number; season?: Season; stats?: SeasonLine[]; roster?: Player[];
  // The games to show (lib/schedule gameDay): being played, then the next game day's, with who is down to score each.
  day?: { game: Game; stale: boolean; lineups: Partial<Record<Side, Lineup>>; scorers?: { user_id: string; name: string }[] }[];
  // This person's notification settings for the team, and who they are (to say "you are scoring").
  prefs?: NotifyPrefs; me?: string;
}) {
  const who = new Map(roster.map((p) => [p.id, p]));
  const top = leaders(stats);
  const base = `/t/${team.slug}`;
  const steps = [
    { href: `${base}/roster`, title: 'Roster', done: players >= 9,
      meta: players === 0 ? 'Add your players, or paste the list' : `${players} ${players === 1 ? 'player' : 'players'}${players < 9 ? ' · nine fills a lineup' : ''}` },
    { href: `${base}/opponents`, title: 'Opponents', done: opponents > 0,
      meta: opponents ? `${opponents} ${opponents === 1 ? 'team' : 'teams'} you play` : 'Add the teams you play: logo, colors, roster' },
    { href: `${base}/season`, title: 'Season', done: !!season,
      meta: season ? season.name : 'Name the season the stats will count for' },
  ];
  return (
    <div className="page wide today" style={{ paddingTop: 10 }}>
      <h1 className="wide-title disp">Today</h1>
      {day.length ? day.map(({ game, stale, lineups, scorers = [] }) => (
        <section key={game.id} className={`card next-game${stale ? ' stale' : ''}`}>
          <div className="next-top">
            <span className="eyebrow gold">{stale ? 'Never ended' : game.status === 'live' ? 'Live now' : <LocalTime iso={game.starts_at} />}</span>
            <span className="sub">{stale ? <LocalTime iso={game.starts_at} /> : game.venue}</span>
          </div>
          <Matchup team={team} game={game} />
          {stale ? (
            <p className="note note-bad">Still marked live. End it on the pad so the stream, the stats and the pitching decisions show it as final.</p>
          ) : <GamePlace game={game} compact />}
          {scorers.length > 0 && (
            <p className={`note ${scorers.some((x) => x.user_id === me) ? 'note-good' : 'note-plain'}`}>
              {scorers.some((x) => x.user_id === me) ? 'You are scoring this game.' : 'Scoring:'} {scorers.filter((x) => x.user_id !== me).map((x) => x.name).join(', ')}
            </p>
          )}
          <div className="next-foot">
            {stale ? <span /> : game.sport === 'baseball' ? <Readiness lineup={lineups.us} /> : <span className="sub">Score only</span>}
            <div className="btn-row">
              {canRunGames(role)
                ? <Link href={`/pad/${team.slug}/${game.id}${stale ? '?end=1' : ''}`} className="btn btn-primary">{stale ? 'End it on the pad' : game.status === 'live' ? 'Back to the pad' : 'Open the pad'}</Link>
                : canBroadcast(role) && <Link href={`/pad/${team.slug}/${game.id}`} className="btn btn-primary">Open On Air</Link>}
              {game.sport === 'baseball' && !stale && canRunGames(role) && <Link href={`${base}/games/${game.id}/lineup`} className="btn btn-quiet">Lineup</Link>}
            </div>
          </div>
        </section>
      )) : (
        <section className="card next-game">
          <div className="next-top">
            <span className="eyebrow gold">Next game</span>
            <span className="sub">{season?.name}</span>
          </div>
          <Slab brand={brandOf(team)} sub={`${team.name}${team.age_group ? ` ${team.age_group}` : ''}`} />
          <div className="next-foot">
            <p className="sub">Nothing on the schedule.</p>
            {canMakeGames(role) && <Link href={`${base}/games/new`} className="btn btn-primary">New game</Link>}
          </div>
        </section>
      )}

      {top.length > 0 && (
        <section className="leaders">
          <div className="h-row" style={{ padding: '2px 4px 2px' }}>
            <h2 className="h-sec">Team leaders</h2>
            {canBroadcast(role) && <Link href={`${base}/stats`} className="link">Full stats</Link>}
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

      {prefs && <NotifyCard slug={team.slug} prefs={prefs} />}

      {canSeeTeam(role) && <section className="setup">
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
      </section>}
    </div>
  );
}
