'use client';

import { useState } from 'react';
import type { Broadcast, BroadcastPatch } from '@/lib/broadcast';

const MAX = 60;
type Draft = { line1: string; line2: string; storyline: string };
const FIELDS: [keyof Draft, string][] = [['line1', 'Line 1'], ['line2', 'Line 2'], ['storyline', 'Storyline']];

// The pregame blurb on Starting Soon. Claude writes a draft on request; the
// operator reads it, fixes it, and only Use puts it on the stream. If the call
// fails, nothing on the stream changes.
export function BlurbControl({ gameId, broadcast, onBroadcast }: {
  gameId: string; broadcast: Broadcast | null | undefined; onBroadcast: (patch: BroadcastPatch) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = broadcast?.blurb?.game_id === gameId ? broadcast.blurb : null;

  async function write() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ai/blurb', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Could not write one. The stream is unchanged.'); return; }
      setDraft(body.blurb);
      setWarnings(body.warnings ?? []);
    } catch {
      setError('No connection. The stream is unchanged.');
    } finally {
      setBusy(false);
    }
  }
  const tooLong = draft ? FIELDS.some(([k]) => draft[k].length > MAX) : false;

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="eyebrow">Pregame blurb · on Starting soon</p>
      {current && (
        <div className="note note-plain">
          <b>{current.line1}</b><br />{current.line2}<br /><i>{current.storyline}</i>
          <div className="pgrid two" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-quiet" onClick={() => setDraft({ line1: current.line1, line2: current.line2, storyline: current.storyline })}>Edit</button>
            <button type="button" className="btn btn-danger" onClick={() => onBroadcast({ blurb: null })}>Clear</button>
          </div>
        </div>
      )}
      {!draft && (
        <button type="button" className="btn btn-quiet" onClick={write} disabled={busy} aria-busy={busy}>
          {busy ? 'Writing…' : current ? 'Write a new one' : 'Write a pregame blurb'}
        </button>
      )}
      {error && <p role="alert" className="note note-bad">{error}</p>}
      {draft && (
        <>
          {warnings.length > 0 && <p role="alert" className="note note-bad">Check before using: {warnings.join(' ')}</p>}
          {FIELDS.map(([k, label]) => (
            <label key={k} className="field">
              <span>{label} · <b style={draft[k].length > MAX ? { color: 'var(--bad-text)' } : undefined}>{draft[k].length}/{MAX}</b></span>
              <input className="input" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
            </label>
          ))}
          <div className="pgrid two">
            <button type="button" className="btn btn-quiet" onClick={() => { setDraft(null); setWarnings([]); }}>Discard</button>
            <button type="button" className="btn btn-primary" disabled={tooLong || !draft.line1.trim()}
              onClick={() => { onBroadcast({ blurb: { game_id: gameId, line1: draft.line1.trim(), line2: draft.line2.trim(), storyline: draft.storyline.trim() } }); setDraft(null); setWarnings([]); }}>
              Use
            </button>
          </div>
          {!busy && <button type="button" className="link" onClick={write}>Write another</button>}
        </>
      )}
    </div>
  );
}
