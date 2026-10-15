'use client';

import { useMemo, useState } from 'react';
import { importStats } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { LocalTime } from '@/components/LocalTime';
import { matchRows, padGameLabel, padGamesWhy, parseGameChanger, type ImportRow, type PadGame, type RosterRef } from '@/lib/gamechanger';
import { batting, innings, rate3, type SeasonLine } from '@/lib/stats';
import type { Season } from '@/lib/types';

// Choose the export, see who each row is, import. The file never leaves the
// browser as a file: it is read here, and only the rows chosen go to the
// server, where every number is checked again. A season the pad has scored
// games in is closed to imports (padGamesBlock), and says which games.
export function ImportFlow({ slug, seasons, roster, seasonId, padGames }: {
  slug: string; seasons: Season[]; roster: RosterRef[]; seasonId?: string; padGames: Record<string, PadGame[]>;
}) {
  const [season, setSeason] = useState(() =>
    seasons.find((s) => s.id === seasonId)?.id ?? seasons.find((s) => s.is_current)?.id ?? seasons[0].id);
  const scored = padGames[season] ?? [];
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [choice, setChoice] = useState<string[]>([]);

  async function read(file: File | undefined) {
    setError(''); setRows(null);
    if (!file) return;
    try {
      const { rows: r, warnings: w } = parseGameChanger(await file.text());
      setRows(r); setWarnings(w);
      setChoice(matchRows(r, roster).map((id) => id ?? 'new'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file could not be read.');
    }
  }

  const payload = useMemo(() => JSON.stringify((rows ?? []).map((r, i) => ({
    match: choice[i], number: r.number, first_name: r.first_name, last_name: r.last_name, counts: r.counts,
  }))), [rows, choice]);
  const name = (r: { number: string; first_name: string; last_name: string }) =>
    `${r.number ? `#${r.number} ` : ''}${r.first_name} ${r.last_name}`.trim();
  const fresh = choice.filter((c) => c === 'new').length;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <label className="field"><span>Import into</span>
        <select className="select" value={season} onChange={(e) => setSeason(e.currentTarget.value)}>
          {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_current ? ' (current)' : ''}</option>)}
        </select>
      </label>

      {scored.length > 0 ? (
        <div role="alert" className="note note-bad stack" style={{ gap: 8 }}>
          <strong>No import for this season: {scored.length === 1 ? '1 game was' : `${scored.length} games were`} scored in Scoreboard.</strong>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {scored.map((g) => <li key={g.id}><LocalTime iso={g.starts_at} mode="day" /> {padGameLabel(g)}</li>)}
          </ul>
          <span>{padGamesWhy(scored.length)}</span>
        </div>
      ) : (<>
      <label className="field"><span>GameChanger export (.csv)</span>
        <input className="input file" type="file" accept=".csv,text/csv" onChange={(e) => read(e.currentTarget.files?.[0])} />
      </label>
      <p className="hint">In GameChanger, open the team, then Stats, then the export button. One file holds a whole season.</p>
      {error && <p role="alert" className="note note-bad">{error}</p>}

      {rows && (
        <ActionForm action={importStats.bind(null, slug)} className="form">
          <input type="hidden" name="rows" value={payload} />
          <input type="hidden" name="season_id" value={season} />
          {warnings.map((w) => <p key={w} className="note note-plain">{w}</p>)}

          <div className="col-head" style={{ padding: '4px 4px 0' }}>
            <span style={{ flex: 1 }}>{rows.length} players in the file</span>
            <span style={{ width: 54, textAlign: 'right' }}>AVG</span>
            <span style={{ width: 40, textAlign: 'right' }}>IP</span>
          </div>
          <div className="rows">
            {rows.map((r, i) => {
              const avg = batting({ ...r.counts, player_id: '', season_id: '', imported_at: null } as SeasonLine).avg;
              return (
                <div key={i} className="row import-row">
                  <div className="row-main">
                    <span className="row-title">{name(r)}</span>
                    <select className="select select-chip" aria-label={`Who is ${name(r)}`} value={choice[i]}
                      onChange={(e) => { const v = e.currentTarget.value; setChoice((c) => c.map((x, j) => (j === i ? v : x))); }}>
                      <option value="new">Add as a new player</option>
                      <option value="skip">Skip this row</option>
                      {roster.map((p) => <option key={p.id} value={p.id}>{name(p)}</option>)}
                    </select>
                  </div>
                  <span className="row-meta" style={{ width: 54, textAlign: 'right' }}>{r.counts.b_pa ? rate3(avg) : '–'}</span>
                  <span className="row-meta" style={{ width: 40, textAlign: 'right' }}>{r.counts.p_outs ? innings(r.counts.p_outs) : '–'}</span>
                </div>
              );
            })}
          </div>

          <p className="hint">
            {fresh > 0 && `${fresh} ${fresh === 1 ? 'player is' : 'players are'} not on the roster and will be added. `}
            Importing replaces any earlier GameChanger import for this season. Games you score in Scoreboard are added on top, so
            import only the games GameChanger scored.
          </p>
          <Submit className="btn btn-primary btn-big" busy="Importing…">Import {rows.length - choice.filter((c) => c === 'skip').length} players</Submit>
        </ActionForm>
      )}
      </>)}
    </div>
  );
}
