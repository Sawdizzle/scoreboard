'use client';

import { useMemo, useState } from 'react';
import type { GameFacts } from '@/lib/summarize';
import { description, stamp, type Mark, type YoutubeText } from '@/lib/youtube';

type Pack = { text: YoutubeText; facts: GameFacts; halves: Mark[]; scoring: Mark[]; highlights?: Mark[]; first: string | null; streamStart: string | null; warnings: string[] };

// "12:34" or "1:02:03" to seconds; null if it is not a time.
const seconds = (s: string) => {
  const p = s.trim().split(':').map(Number);
  if (!p.length || p.length > 3 || p.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { /* select it by hand */ }
    }}>{done ? 'Copied' : label}</button>
  );
}

// The game video's title and description, ready to paste into YouTube Studio.
// Chapters need to know where first pitch is in the video: the stream's start
// time gives it when OBS reported one, and the coach can always correct it.
export function YoutubeCard({ gameId }: { gameId: string }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [offset, setOffset] = useState('');

  async function write() {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/ai/youtube', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'That did not work. Try again.'); return; }
      setPack(body); setTitle(body.text.title);
      setOffset(body.streamStart && body.first ? stamp((Date.parse(body.first) - Date.parse(body.streamStart)) / 1000) : '');
    } catch {
      setError('No connection. Try again when you have signal.');
    } finally {
      setBusy(false);
    }
  }

  const start = useMemo(() => {
    if (!pack?.first) return null;
    const s = seconds(offset);
    return s === null || !offset.trim() ? null : new Date(Date.parse(pack.first) - s * 1000).toISOString();
  }, [pack, offset]);
  const text = pack ? description({ text: { ...pack.text, title }, facts: pack.facts, halves: pack.halves, scoring: pack.scoring, highlights: pack.highlights, streamStart: start }) : '';

  return (
    <section className="card pad">
      <h2 className="h-sec">YouTube</h2>
      {!pack && <p className="hint">A title and description for the game video, with chapters for each half-inning and the time of every scoring play.</p>}
      <button type="button" className={pack ? 'btn' : 'btn btn-primary'} onClick={write} disabled={busy} aria-busy={busy}>
        {busy ? 'Writing…' : pack ? 'Write it again' : 'Write the YouTube description'}
      </button>
      {error && <p role="alert" className="note note-bad">{error}</p>}
      {pack && (
        <>
          {pack.warnings.length > 0 && <p role="alert" className="note note-bad">Check: {pack.warnings.join(' ')}</p>}
          <label className="field"><span>Title · {title.length}/100</span>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <Copy text={title} label="Copy title" />
          {pack.first && <label className="field"><span>First pitch in the video at (minutes:seconds)</span>
            <input className="input" inputMode="numeric" placeholder="e.g. 4:30" value={offset} onChange={(e) => setOffset(e.target.value)} />
          </label>}
          <p className="hint">{!pack.first
            ? 'This game has no play times (it was brought over from the old app), so there are no chapters.'
            : pack.streamStart
              ? 'Worked out from when OBS went live. If the chapters are off, scrub the video to the first pitch and put its time here.'
              : 'OBS did not report when the stream started. Scrub the video to the first pitch and put its time here to add chapters.'}</p>
          <label className="field"><span>Description</span>
            <textarea className="textarea" style={{ fontFamily: 'inherit', minHeight: 320 }} readOnly value={text} />
          </label>
          <Copy text={text} label="Copy description" />
        </>
      )}
    </section>
  );
}
