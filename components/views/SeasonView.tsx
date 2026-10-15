import Link from 'next/link';
import { createSeason, deleteSeason, makeSeasonCurrent, updateSeason } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { Plus } from '@/components/icons';
import { StatTables } from '@/components/StatTables';
import { ScheduleList } from '@/components/GameBits';
import { guessSeason, shortDate } from '@/lib/format';
import { splitSchedule } from '@/lib/schedule';
import { batting, rate3, type SeasonLine } from '@/lib/stats';
import { canEditTeam, canRunGames, type Game, type Player, type Role, type Season, type Team } from '@/lib/types';

function SeasonFields({ s }: { s?: Season }) {
  return (
    <>
      <label className="field"><span>Name</span>
        <input className="input" name="name" defaultValue={s?.name ?? guessSeason()} maxLength={40} required autoComplete="off" />
      </label>
      <div className="field-row">
        <label className="field"><span>Starts</span><input className="input" type="date" name="starts_on" defaultValue={s?.starts_on ?? ''} /></label>
        <label className="field"><span>Ends</span><input className="input" type="date" name="ends_on" defaultValue={s?.ends_on ?? ''} /></label>
      </div>
      <label className="field"><span>Innings in a game · for ERA</span>
        <input className="input" type="number" name="game_innings" min={3} max={9} defaultValue={s?.game_innings ?? 7} inputMode="numeric" />
      </label>
    </>
  );
}

// The whole team's season added into one line, for the strip at the top.
function teamLine(stats: SeasonLine[]) {
  const sum = (k: keyof SeasonLine) => stats.reduce((a, s) => a + (Number(s[k]) || 0), 0);
  const t = Object.fromEntries(Object.keys(stats[0]).map((k) => [k, sum(k as keyof SeasonLine)])) as unknown as SeasonLine;
  const b = batting(t);
  return [
    { v: rate3(b.avg), k: 'Team avg' }, { v: rate3(b.obp), k: 'OBP' },
    { v: String(t.b_r), k: 'Runs' }, { v: String(t.b_sb), k: 'Steals' },
  ];
}

export function SeasonView({ team, role, seasons, selectedId, stats = [], players = [], imported, games = [] }: {
  team: Team; role: Role; seasons: Season[]; selectedId?: string;
  stats?: SeasonLine[]; players?: Player[]; imported?: string; games?: Game[];
}) {
  const edit = canEditTeam(role);
  const base = `/t/${team.slug}/season`;
  const sel = seasons.find((s) => s.id === selectedId) ?? seasons.find((s) => s.is_current) ?? seasons[0];
  const dates = sel && (sel.starts_on || sel.ends_on)
    ? [shortDate(sel.starts_on) || 'Open start', shortDate(sel.ends_on) || 'open end'].join(' to ')
    : null;
  const { upcoming, completed } = splitSchedule(games);
  return (
    <div className="page wide" style={{ paddingTop: 10 }}>
      {seasons.length > 0 && (
        <nav className="chips" aria-label="Seasons">
          {seasons.map((s) => (
            <Link key={s.id} href={`${base}?s=${s.id}`} className="chip" aria-current={s.id === sel?.id ? 'page' : undefined}>
              {s.is_current && <span className="dot" title="Current season" />}{s.name}
            </Link>
          ))}
        </nav>
      )}

      {sel ? (
        <>
          <section className="stack" style={{ gap: 6, padding: '0 4px' }}>
            <span className={`eyebrow${sel.is_current ? ' gold' : ''}`}>{sel.is_current ? 'Current season' : 'Past season'}</span>
            <h1 className="disp h1">{sel.name}</h1>
            <span className="sub">{[dates, `${sel.game_innings}-inning games`].filter(Boolean).join(' · ')}</span>
          </section>

          {imported && <p role="status" className="note note-good">Imported {imported} players from GameChanger.</p>}

          <section className="stack" style={{ gap: 6 }}>
            <div className="h-row" style={{ padding: '0 4px', alignItems: 'center' }}>
              <h2 className="h-sec">Schedule</h2>
              {canRunGames(role) && <Link href={`/t/${team.slug}/games/new`} className="link"><Plus /> New game</Link>}
            </div>
            {upcoming.length ? <ScheduleList slug={team.slug} games={upcoming} />
              : <p className="sub" style={{ padding: '0 4px' }}>{completed.length ? `No games left in ${sel.name}.` : `No games in ${sel.name} yet.`}</p>}
          </section>

          {completed.length > 0 && (
            <section className="stack" style={{ gap: 6 }}>
              <div className="h-row" style={{ padding: '0 4px', alignItems: 'center' }}>
                <h2 className="h-sec">Completed</h2>
                <span className="sub">{completed.length} played</span>
              </div>
              <ScheduleList slug={team.slug} games={completed} />
            </section>
          )}

          {stats.length > 0 ? (
            <>
              <div className="slash">
                {teamLine(stats).map((x) => <div key={x.k}><b className="live">{x.v}</b><span>{x.k.toUpperCase()}</span></div>)}
              </div>
              <StatTables slug={team.slug} lines={stats} players={players} gameInnings={sel.game_innings} fmt={team.name_format} />
              <p className="source">From GameChanger, imported {shortDate(stats.reduce((a, s) => (s.imported_at && s.imported_at > a ? s.imported_at : a), ''))}.</p>
            </>
          ) : (
            <div className="card empty">
              <b>No stats for {sel.name} yet</b>
              {edit ? 'Bring in what GameChanger already has, or score games here once game night is built.' : 'They arrive from GameChanger imports and scored games.'}
            </div>
          )}

          {edit && (
            <Link href={`/t/${team.slug}/season/import?s=${sel.id}`} className="btn btn-quiet btn-block">
              {stats.length ? 'Import from GameChanger again' : 'Import from GameChanger'}
            </Link>
          )}

          {edit && (
            <div className="folds">
              {!sel.is_current && (
                <ActionForm action={makeSeasonCurrent.bind(null, team.slug, sel.id)}>
                  <Submit className="btn btn-quiet btn-block" busy="Switching…">Make {sel.name} the current season</Submit>
                </ActionForm>
              )}
              <details className="fold">
                <summary>Edit {sel.name}</summary>
                <div className="fold-body">
                  <ActionForm key={sel.id} action={updateSeason.bind(null, team.slug, sel.id)} className="form">
                    <SeasonFields s={sel} />
                    <Submit busy="Saving…">Save season</Submit>
                  </ActionForm>
                </div>
              </details>
              <details className="fold">
                <summary><span className="plus"><Plus /></span>New season</summary>
                <div className="fold-body">
                  <ActionForm action={createSeason.bind(null, team.slug)} className="form">
                    <SeasonFields />
                    <label className="switch">
                      <span className="switch-text"><b>Make it the current season</b><small>New games count for the current season.</small></span>
                      <input type="checkbox" name="is_current" defaultChecked />
                    </label>
                    <Submit busy="Creating…">Create season</Submit>
                  </ActionForm>
                </div>
              </details>
              <details className="fold danger">
                <summary>Delete {sel.name}</summary>
                <div className="fold-body">
                  <ActionForm action={deleteSeason.bind(null, team.slug, sel.id)} className="form">
                    <p className="hint">The season has no games, so nothing else goes with it.</p>
                    <Submit className="btn btn-danger" busy="Deleting…">Delete season</Submit>
                  </ActionForm>
                </div>
              </details>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="card empty">
            <b>No season yet</b>
            A season is what stats add up over: Fall, Spring, a tournament run.
          </div>
          {edit && (
            <div className="card pad">
              <ActionForm action={createSeason.bind(null, team.slug)} className="form">
                <SeasonFields />
                <input type="hidden" name="is_current" value="on" />
                <Submit busy="Creating…">Create season</Submit>
              </ActionForm>
            </div>
          )}
        </>
      )}
    </div>
  );
}
