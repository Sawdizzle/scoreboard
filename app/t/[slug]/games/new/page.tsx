import type { Metadata } from 'next';
import Link from 'next/link';
import { createGame } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { GameFields } from '@/components/GameFields';
import { ChevronLeft } from '@/components/icons';
import { findTeams, listSeasons, loadTeam } from '@/lib/data';
import { inkOn } from '@/lib/format';
import { canRunGames, type Team } from '@/lib/types';

export const metadata: Metadata = { title: 'New game' };

// Find the other team on Pressbox (its roster comes along), or just type its
// name. Searching is a plain GET, so the page works before any script loads.
export default async function NewGame({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string; opp?: string; typed?: string }>;
}) {
  const { slug } = await params;
  const { q = '', opp, typed } = await searchParams;
  const { supabase, team, role } = await loadTeam(slug);
  const seasons = await listSeasons(supabase, team.id);
  const results = q ? await findTeams(supabase, q, team.id) : [];
  let opponent: Team | null = null;
  if (opp && /^[0-9a-f-]{36}$/i.test(opp) && opp !== team.id) {
    const { data } = await supabase.from('teams').select('id, slug, name, abbr, color, logo_url, age_group').eq('id', opp).maybeSingle<Team>();
    opponent = data;
  }
  const base = `/t/${slug}/games/new`;
  const picking = !opponent && !typed;
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
            <button type="submit" className="btn btn-quiet">Search Pressbox</button>
          </form>
          {q && (
            <div className="stack">
              {results.length === 0 && <p className="sub" style={{ padding: '0 4px' }}>No team called &ldquo;{q}&rdquo; on Pressbox.</p>}
              {results.map((t) => (
                <Link key={t.id} href={`${base}?opp=${t.id}`} className="card seat">
                  <span className="crest" style={{ '--team': t.color, '--team-ink': inkOn(t.color), fontSize: t.abbr.length > 4 ? 13 : 19 } as React.CSSProperties}>{t.abbr}</span>
                  <span className="row-main">
                    <span className="row-title">{t.name}{t.age_group && <small>{t.age_group}</small>}</span>
                    <span className="row-meta">On Pressbox · roster loads itself</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
          <Link href={`${base}?typed=1${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="btn btn-ghost">Not on Pressbox · type the name</Link>
        </>
      ) : (
        <ActionForm action={createGame.bind(null, slug)} className="form">
          <GameFields seasons={seasons} opponent={opponent} changeHref={base} />
          <Submit className="btn btn-primary btn-big" busy="Creating…">Create game · set lineups</Submit>
        </ActionForm>
      )}
    </div>
  );
}
