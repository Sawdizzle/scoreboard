'use client';

import { useState } from 'react';
import { importGames } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';

type Found = { date: string; time: string; opponent: string; home: 'home' | 'away' | 'unknown'; venue: string; address: string; note: string; starts_at: string; dup: boolean };
const when = (iso: string, time: string) => new Date(iso).toLocaleString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}), timeZone: 'America/Chicago' });

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

  async function read() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ai/schedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId, text, url }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'That did not work. Try again.'); return; }
      setFound(body.games); setUnsure(body.unsure ?? []);
      setPick((body.games as Found[]).map((g) => !g.dup));
    } catch {
      setError('No connection. Try again when you have signal.');
    } finally {
      setBusy(false);
    }
  }
  const chosen = found?.filter((_, i) => pick[i]) ?? [];

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
                <input type="checkbox" checked={pick[i]} onChange={(e) => setPick(pick.map((p, j) => (j === i ? e.target.checked : p)))} style={{ marginTop: 4 }} />
                <span className="row-main" style={{ gap: 2 }}>
                  <span className="row-title">{g.home === 'away' ? 'at' : 'vs'} {g.opponent}</span>
                  <span className="sub">{when(g.starts_at, g.time)}{g.time ? '' : ' · time not given'}{g.venue ? ` · ${g.venue}` : ''}</span>
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
