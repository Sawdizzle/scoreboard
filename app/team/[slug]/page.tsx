import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronRight } from '@/components/icons';
import { LocalTime } from '@/components/LocalTime';
import { StatTables } from '@/components/StatTables';
import { Slab, brandOf } from '@/components/TeamBrand';
import { TEAM_COLS, listGames, listSeasons, publicRoster, seasonStats } from '@/lib/data';
import { result } from '@/lib/public';
import { splitSchedule } from '@/lib/schedule';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import type { Game, Team } from '@/lib/types';

type Props = { params: Promise<{ slug: string }> };

async function load(slug: string) {
  if (!supabaseConfigured) notFound();
  const supabase = await createClient();
  const { data: team } = await supabase.from('teams').select(TEAM_COLS).eq('slug', slug).maybeSingle<Team>();
  if (!team) notFound();
  return { supabase, team };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { team } = await load((await params).slug);
  return { title: team.name, description: `${team.name}: schedule, scores, roster and season stats.` };
}

// A team as anyone may see it: no account, and every player under the name
// their staff chose to show. Scores and stats come from the same plays the
// scorer tapped in.
export default async function TeamPage({ params }: Props) {
  const { supabase, team } = await load((await params).slug);
  const [seasons, roster] = await Promise.all([listSeasons(supabase, team.id), publicRoster(supabase, team.id)]);
  const season = seasons.find((s) => s.is_current) ?? seasons[0];
  const [games, lines] = await Promise.all([
    listGames(supabase, team.id, season?.id),
    season ? seasonStats(supabase, team.id, season.id) : [],
  ]);
  const live = games.find((g) => g.status === 'live');
  const finals = games.filter((g) => g.status === 'final').map(result);
  const record = finals.length ? `${finals.filter((r) => r?.startsWith('W')).length}-${finals.filter((r) => r?.startsWith('L')).length}` : null;
  const players = roster.map((r) => ({ id: r.id, number: r.number, first_name: r.display_name ?? '', last_name: '' }));
  const base = `/team/${team.slug}`;
  const { upcoming, completed } = splitSchedule(games);

  return (
    <main className="shell has-tabs" style={{ '--team': team.color, paddingBottom: 32 } as React.CSSProperties}>
      <div className="page" style={{ paddingTop: 16 }}>
        <Slab brand={brandOf(team)} sub={[team.age_group, season?.name, record].filter(Boolean).join(' · ')} />

        {live && (
          <Link href={`${base}/game/${live.id}`} className="card pub-live">
            <span className="eyebrow gold">Live now</span>
            <b>{live.is_home ? 'vs' : 'at'} {live.opponent_name}</b>
            <span className="btn btn-primary">Follow the game</span>
          </Link>
        )}

        <section className="stack" style={{ gap: 8 }}>
          <h2 className="h-sec" style={{ padding: '0 4px' }}>Schedule</h2>
          {upcoming.length ? <GameRows base={base} games={upcoming} />
            : <p className="sub" style={{ padding: '0 4px' }}>{completed.length ? 'No games left this season.' : 'No games on the schedule yet.'}</p>}
        </section>

        {completed.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="h-row" style={{ padding: '0 4px', alignItems: 'center' }}>
              <h2 className="h-sec">Completed</h2>
              <span className="sub">{completed.length} played</span>
            </div>
            <GameRows base={base} games={completed} />
          </section>
        )}

        {season && <StatTables slug={team.slug} lines={lines} players={players} gameInnings={season.game_innings} link={false} />}

        <section className="stack" style={{ gap: 8 }}>
          <h2 className="h-sec" style={{ padding: '0 4px' }}>Roster</h2>
          {roster.length ? (
            <div className="card" style={{ padding: '4px 12px' }}>
              <div className="rows">
                {roster.map((p) => (
                  <div key={p.id} className="row">
                    <span className="jersey">{p.number || '–'}</span>
                    <span className="row-main"><span className="row-title">{p.display_name || `No. ${p.number}`}</span></span>
                    <span className="sub">{p.positions.join(' · ')}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="sub" style={{ padding: '0 4px' }}>No roster yet.</p>}
        </section>

        <p className="pub-foot">Scored on <Link href="/" className="link">Scoreboard</Link></p>
      </div>
    </main>
  );
}

function GameRows({ base, games }: { base: string; games: Game[] }) {
  return (
    <div className="card" style={{ padding: '4px 12px' }}>
      <div className="rows">
        {games.map((g) => (
          <Link key={g.id} href={`${base}/game/${g.id}`} className="game-row">
            <span className="game-when"><LocalTime iso={g.starts_at} mode="day" /><LocalTime iso={g.starts_at} mode="time" /></span>
            <span className="row-main">
              <span className="row-title">{g.is_home ? 'vs' : 'at'} {g.opponent_name}</span>
              <span className="row-meta">{[g.venue, g.counts_for_stats ? null : 'Scrimmage'].filter(Boolean).join(' · ') || ' '}</span>
            </span>
            <span className={`pub-result${g.status === 'live' ? ' live' : ''}`}>{g.status === 'live' ? 'Live' : result(g) ?? ''}</span>
            <span className="chev"><ChevronRight /></span>
          </Link>
        ))}
      </div>
    </div>
  );
}
