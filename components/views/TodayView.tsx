import Link from 'next/link';
import { Check, ChevronRight } from '@/components/icons';
import { SEATS, canEditTeam, type Role, type Season, type Team } from '@/lib/types';

// Today, before there is a game to put on it: what the team has, and what it
// still needs. The Tonight card takes the top of this screen once games exist.
export function TodayView({ team, role, players, staff, season }: {
  team: Team; role: Role; players: number; staff: number; season?: Season;
}) {
  const base = `/t/${team.slug}`;
  const steps = [
    { href: `${base}/roster`, title: 'Roster', done: players >= 9,
      meta: players === 0 ? 'Add your players, or paste the list' : `${players} ${players === 1 ? 'player' : 'players'}${players < 9 ? ' · nine fills a lineup' : ''}` },
    { href: `${base}/staff`, title: 'Staff', done: staff > 1,
      meta: `${staff} of ${SEATS} seats${staff === 1 ? ' · invite a coach or scorer' : ''}` },
    { href: `${base}/season`, title: 'Season', done: !!season,
      meta: season ? season.name : 'Name the season the stats will count for' },
  ];
  return (
    <div className="page" style={{ paddingTop: 10 }}>
      <section className="card next-game">
        <div className="next-top">
          <span className="eyebrow gold">Next game</span>
          <span className="sub">{season?.name}</span>
        </div>
        <div className="next-slab slab">
          <span className="disp">{team.abbr}</span>
          <small>{team.name}{team.age_group ? ` ${team.age_group}` : ''}</small>
        </div>
        <div className="next-foot">
          <p className="sub">No game on the schedule. Games, lineups and scoring are the next part of the build; the team you set up here is what they will use.</p>
        </div>
      </section>

      <section>
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
