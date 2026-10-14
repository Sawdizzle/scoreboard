import type { Metadata } from 'next';
import Link from 'next/link';
import { createGame, deleteOpponent } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { GameFields } from '@/components/GameFields';
import { ChevronLeft } from '@/components/icons';
import { TEAM_COLS, findTeams, listOpponents, listSeasons, loadTeam, type SavedOpponent } from '@/lib/data';
import { TeamMark, brandOf } from '@/components/TeamBrand';
import { canRunGames, type Team } from '@/lib/types';

export const metadata: Metadata = { title: 'New game' };

// Find the other team on Scoreboard (its roster comes along), or just type its
// name. Searching is a plain GET, so the page works before any script loads.
export default async function NewGame({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; opp?: string; typed?: string; saved?: string }>;
}) {
  const { slug } = await params;
  const { q = '', opp, typed, saved: savedId } = await searchParams;
  const { supabase, team, role } = await loadTeam(slug);
  const seasons = await listSeasons(supabase, team.id);
  const results = q ? await findTeams(supabase, q, team.id) : [];
  let opponent: Team | null = null;
  if (opp && /^[0-9a-f-]{36}$/i.test(opp) && opp !== team.id) {
    const { data } = await supabase.from('teams').select(TEAM_COLS).eq('id', opp).maybeSingle<Team>();
    opponent = data;
  }
  const opponents = canRunGames(role) ? await listOpponents(supabase, team.id) : [];
  const saved = opponents.find((o) => o.id === savedId) ?? null;
  const filled = (o: SavedOpponent) => (o.roster?.batters ?? []).filter((b) => b.num || b.name).length;
  const base = `/t/${slug}/games/new`;
  const picking = !opponent && !typed && !saved;
  return (
    <div className="page" style={{ paddingTop: 6 }}>
      <div className="h-row" style={{ justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
        <Link href={`/t/${slug}`} aria-label="Back" className="icon-btn" style={{ border: 0, marginLeft: -10 }}><ChevronLeft /></Link>
        <h1 className="disp h1">New game</h1>
      </div>
      {!canRunGames(role) ? (
        <p className="note note-plain">Coaches, scorers and organizers make games.</p>
      ) : picking ? (
        <>
          <form className="form" action={base} method="get">
            <label className="field"><span>Who are you playing?</span>
              <input className="input" type="search" name="q" defaultValue={q} placeholder="Team name" autoComplete="off" autoFocus />
            </label>
            <button type="submit" className="btn btn-quiet">Search Scoreboard</button>
          </form>
          {q && (
            <div className="stack">
              {results.length === 0 && <p className="sub" style={{ padding: '0 4px' }}>No team called &ldquo;{q}&rdquo; on Scoreboard.</p>}
              {results.map((t) => (
                <Link key={t.id} href={`${base}?opp=${t.id}`} className="card seat">
                  <TeamMark brand={brandOf(t)} />
                  <span className="row-main">
                    <span className="row-title">{t.name}{t.age_group && <small>{t.age_group}</small>}</span>
                    <span className="row-meta">On Scoreboard · roster loads itself</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
          <Link href={`${base}?typed=1${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="btn btn-ghost">Not on Scoreboard · type the name</Link>
          {opponents.length > 0 && (
            <section className="stack" style={{ gap: 8 }}>
              <h2 className="h-sec" style={{ padding: '0 4px' }}>Teams you have played</h2>
              {opponents.map((o) => (
                <div key={o.id} className="card seat">
                  <Link href={`${base}?saved=${o.id}`} className="seat-link">
                    <TeamMark brand={{ name: o.name, display: o.name, color: o.color, color2: '#f2f6fc', logo: null }} />
                    <span className="row-main">
                      <span className="row-title">{o.name}</span>
                      <span className="row-meta">{filled(o) ? `${filled(o)} players from last time` : 'No lineup saved yet'}</span>
                    </span>
                  </Link>
                  <ActionForm action={deleteOpponent.bind(null, slug, o.id)}>
                    <Submit className="link" busy="…">Remove</Submit>
                  </ActionForm>
                </div>
              ))}
            </section>
          )}
        </>
      ) : (
        <ActionForm action={createGame.bind(null, slug)} className="form">
          <GameFields seasons={seasons} opponent={opponent} changeHref={base} saved={saved && { name: saved.name, abbr: saved.abbr, color: saved.color, players: filled(saved) }} />
          <Submit className="btn btn-primary btn-big" busy="Creating…">Create game · set lineups</Submit>
        </ActionForm>
      )}
    </div>
  );
}
