import Link from 'next/link';
import { createSeason, deleteSeason, makeSeasonCurrent, updateSeason } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { Plus } from '@/components/icons';
import { guessSeason, shortDate } from '@/lib/format';
import { canEditTeam, type Role, type Season, type Team } from '@/lib/types';

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
    </>
  );
}

export function SeasonView({ team, role, seasons, selectedId }: { team: Team; role: Role; seasons: Season[]; selectedId?: string }) {
  const edit = canEditTeam(role);
  const base = `/t/${team.slug}/season`;
  const sel = seasons.find((s) => s.id === selectedId) ?? seasons.find((s) => s.is_current) ?? seasons[0];
  const dates = sel && (sel.starts_on || sel.ends_on)
    ? [shortDate(sel.starts_on) || 'Open start', shortDate(sel.ends_on) || 'open end'].join(' to ')
    : null;
  return (
    <div className="page" style={{ paddingTop: 10 }}>
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
          <section className="record">
            <b>0–0</b>
            <div>
              <span className={`eyebrow${sel.is_current ? ' gold' : ''}`}>{sel.is_current ? 'Current season' : 'Past season'}</span>
              <span className="sub">{sel.name}{dates && ` · ${dates}`}</span>
              <span className="sub">No games scored yet</span>
            </div>
          </section>

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
