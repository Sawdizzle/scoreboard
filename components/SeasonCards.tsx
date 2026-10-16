'use client';

import { useState } from 'react';

type Card = { name: string; headline: string; body: string; highlights: string[] };
const text = (c: Card) => `${c.name}: ${c.headline}\n\n${c.body}\n\n${c.highlights.map((h) => `• ${h}`).join('\n')}`;

// Each player's season in a few warm lines, to copy into a message or a team
// email. Written on request; nothing is posted or saved.
export function SeasonCards({ teamId, seasonId, season }: { teamId: string; seasonId: string; season: string }) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  async function write() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ai/cards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamId, seasonId }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'That did not work. Try again.'); return; }
      setCards(body.cards); setWarnings(body.warnings ?? []);
    } catch {
      setError('No connection. Try again when you have signal.');
    } finally {
      setBusy(false);
    }
  }
  async function copy(i: number, t: string) {
    try { await navigator.clipboard.writeText(t); setCopied(i); setTimeout(() => setCopied(null), 2000); } catch { /* select by hand */ }
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <section className="card pad">
        <p className="hint">A short, warm card for each player&rsquo;s {season} season, from their own numbers, for families. Players are named the way the public sees them. Read each one before you send it.</p>
        <button type="button" className={cards ? 'btn' : 'btn btn-primary'} onClick={write} disabled={busy} aria-busy={busy}>
          {busy ? 'Writing the cards… about 30 seconds' : cards ? 'Write them again' : 'Write the season cards'}
        </button>
        {error && <p role="alert" className="note note-bad">{error}</p>}
        {warnings.length > 0 && <p role="alert" className="note note-bad">Check before sending: {warnings.join(' ')}</p>}
        {cards && <button type="button" className="btn" onClick={() => copy(-1, cards.map(text).join('\n\n———\n\n'))}>{copied === -1 ? 'Copied' : 'Copy all'}</button>}
      </section>
      {cards?.map((c, i) => (
        <section key={i} className="card pad">
          <span className="eyebrow gold">{c.name}</span>
          <h2 className="h-sec" style={{ fontSize: 18 }}>{c.headline}</h2>
          <p style={{ margin: 0, lineHeight: 1.55 }}>{c.body}</p>
          {c.highlights.length > 0 && <ul style={{ margin: 0, paddingLeft: 18 }}>{c.highlights.map((h, j) => <li key={j}>{h}</li>)}</ul>}
          <button type="button" className="btn btn-quiet" onClick={() => copy(i, text(c))}>{copied === i ? 'Copied' : 'Copy'}</button>
        </section>
      ))}
    </div>
  );
}
