'use client';

import { useState } from 'react';
import { importGames } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { localToIso } from '@/lib/schedule-import';

type Found = { date: string; time: string; opponent: string; home: 'home' | 'away' | 'unknown'; venue: string; address: string; note: string; starts_at: string | null; dup: boolean };
// With the year, so a wrong one shows.
const when = (date: string, iso: string | null) => new Date(iso ?? `${date}T17:00:00Z`).toLocaleString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', ...(iso ? { hour: 'numeric', minute: '2-digit' } : {}), timeZone: 'America/Chicago' });
// "9:45", "9:45 am", "1:15 PM", "13:15" -> "13:15"; null if it is not a time.
function hhmm(t: string) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*$/i.exec(t);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0);
  if (m[3]) { const pm = /^p/i.test(m[3]); if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null;
}

// Paste a schedule or give its link; Claude picks out this team's games; the
// coach ticks which to add. Games already on the schedule start unticked.
export function ScheduleImport({ slug, teamId }: { slug: string; teamId: string }) {
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [unsure, setUnsure] = useState<string[]>([]);
  const [pick, setPick] = useState<boolean[]>([]);
  const [times, setTimes] = useState<string[]>([]);

  async function read() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ai/schedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId, text, url }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'That did not work. Try again.'); return; }
      setFound(body.games); setUnsure(body.unsure ?? []);
      setPick((body.games as Found[]).map((g) => !g.dup && !!g.starts_at));
      setTimes((body.games as Found[]).map(() => ''));
    } catch {
      setError('No connection. Try again when you have signal.');
    } finally {
      setBusy(false);
    }
  }
  // A game with no time takes the one the coach types; until then it cannot be ticked.
  const start = (g: Found, i: number) => g.starts_at ?? (hhmm(times[i] ?? '') ? localToIso(g.date, hhmm(times[i])!) : null);
  const chosen = found?.map((g, i) => ({ ...g, starts_at: start(g, i) })).filter((g, i) => pick[i] && g.starts_at) ?? [];

  return (
    <div className="stack" style={{ gap: 12 }}>
      {!found && (
        <section className="card pad">
          <label className="field"><span>Paste the schedule</span>
            <textarea className="textarea" style={{ fontFamily: 'inherit', minHeight: 200 }} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={'An email from the tournament, the text of a league page, or a message from the coach.'} />
          </label>
          <label className="field"><span>Or a link to a public schedule page</span>
            <input className="input" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </label>
          <button type="button" className="btn btn-primary" onClick={read} disabled={busy || (!text.trim() && !url.trim())} aria-busy={busy}>
            {busy ? 'Reading the schedule…' : 'Find our games'}
          </button>
          {error && <p role="alert" className="note note-bad">{error}</p>}
          <p className="hint">Times are read as Central time. Nothing is added until you tick the games and tap Add.</p>
        </section>
      )}
      {found && (
        <section className="card pad">
          <h2 className="h-sec">{found.length ? `Found ${found.length} game${found.length === 1 ? '' : 's'}` : 'No games found for this team'}</h2>
          {unsure.length > 0 && <p className="note note-plain">Check: {unsure.join('; ')}</p>}
          <div className="rows">
            {found.map((g, i) => (
              <label key={i} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                <input type="checkbox" checked={pick[i] && !!start(g, i)} disabled={!start(g, i)} onChange={(e) => setPick(pick.map((p, j) => (j === i ? e.target.checked : p)))} style={{ marginTop: 4 }} />
                <span className="row-main" style={{ gap: 2 }}>
                  <span className="row-title">{g.home === 'away' ? 'at' : 'vs'} {g.opponent}</span>
                  <span className="sub">{when(g.date, start(g, i))}{g.venue ? ` · ${g.venue}` : ''}</span>
                  {!g.starts_at && (
                    <input className="input" style={{ minHeight: 40, maxWidth: 200 }} placeholder="First pitch, e.g. 9:45 am" value={times[i] ?? ''} aria-label={`First pitch for ${g.opponent}`}
                      onChange={(e) => { const v = e.target.value; setTimes(times.map((t, j) => (j === i ? v : t))); if (hhmm(v)) setPick(pick.map((p, j) => (j === i ? true : p))); }} />
                  )}
                  {(g.dup || g.note || g.home === 'unknown') && <span className="sub">{[g.dup && 'Already on the schedule', g.home === 'unknown' && 'Home or away not given: added as home', g.note].filter(Boolean).join(' · ')}</span>}
                </span>
              </label>
            ))}
          </div>
          <ActionForm action={importGames.bind(null, slug)} className="form">
            <input type="hidden" name="games" value={JSON.stringify(chosen)} />
            <div className="pgrid two">
              <button type="button" className="btn btn-quiet" onClick={() => { setFound(null); setPick([]); }}>Start over</button>
              <Submit busy="Adding…">{`Add ${chosen.length} game${chosen.length === 1 ? '' : 's'}`}</Submit>
            </div>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
