'use client';

import { useState } from 'react';

type Answer = { answer: string; columns: string[]; rows: string[][]; basis: string };
const EXAMPLES = ['Who gets on base the most?', 'How did our pitchers do in the last 3 games?', 'Who has the most stolen bases?'];

// Ask about the season in plain words; the answer comes from the team's own
// numbers, and says which ones it used.
export function AskStats({ teamId, seasonId }: { teamId: string; seasonId: string }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<(Answer & { q: string }) | null>(null);

  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ai/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId, seasonId, question }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'That did not work. Try again.'); return; }
      setA({ ...body, q: question });
    } catch {
      setError('No connection. Try again when you have signal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pad">
      <form className="stack" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <label className="field"><span>Ask about this season</span>
          <input className="input" value={q} maxLength={300} onChange={(e) => setQ(e.target.value)} placeholder={EXAMPLES[0]} />
        </label>
        <div className="chips">
          {EXAMPLES.map((x) => <button key={x} type="button" className="chip" onClick={() => { setQ(x); void ask(x); }} disabled={busy}>{x}</button>)}
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !q.trim()} aria-busy={busy}>{busy ? 'Looking…' : 'Ask'}</button>
      </form>
      {error && <p role="alert" className="note note-bad">{error}</p>}
      {a && (
        <div className="stack" style={{ gap: 8 }}>
          <p className="eyebrow">{a.q}</p>
          {a.answer.split(/\n\s*\n/).map((p, i) => <p key={i} style={{ margin: 0, lineHeight: 1.5 }}>{p}</p>)}
          {a.columns.length > 0 && a.rows.length > 0 && (
            <div className="table-box">
              <table className="stat-table">
                <thead><tr>{a.columns.map((c, i) => <th key={i} style={i === 0 ? { textAlign: 'left' } : undefined}>{c}</th>)}</tr></thead>
                <tbody>{a.rows.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <td key={j} className="who"><span>{c}</span></td> : <td key={j}>{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {a.basis && <p className="hint">From {a.basis}.</p>}
        </div>
      )}
    </section>
  );
}
