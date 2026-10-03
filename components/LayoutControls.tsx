'use client';

import { useRef, useState } from 'react';
import { BUG_SCALE, CARD_SCALE, layoutOf, type BugPos, type Feed, type Layout } from '@/lib/onair';
import { browserClient } from '@/lib/supabase/browser';

const POS: [BugPos, string][] = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];

// How big the scorebug and the stat cards are on the stream, and which edge
// the scorebug sits on. A slider shows its number as it moves and saves when
// it rests; the stream follows within a few seconds.
export function LayoutControls({ teamId, initial }: { teamId: string; initial: Feed['layout'] }) {
  const [lay, setLay] = useState<Layout>(() => layoutOf(initial));
  const [error, setError] = useState('');
  const timer = useRef(0);
  const set = (next: Layout, wait = 0) => {
    setLay(next);
    setError('');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const { error: e } = await browserClient().from('channels').update({ layout: next }).eq('team_id', teamId);
      if (e) setError('That did not save. Try again.');
    }, wait);
  };
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <div className="air-autos air-qr">
      <label className="air-slide" style={{ borderTop: 0 }}><span>Scorebug size<b>{pct(lay.bug.scale)}</b></span>
        <input type="range" min={BUG_SCALE.min} max={BUG_SCALE.max} step={0.05} value={lay.bug.scale}
          onChange={(e) => set({ ...lay, bug: { ...lay.bug, scale: Number(e.target.value) } }, 250)} />
      </label>
      <div className="air-pos two" role="radiogroup" aria-label="Where the scorebug sits">
        {POS.map(([p, label]) => (
          <button key={p} type="button" role="radio" aria-checked={lay.bug.pos === p} aria-label={label} className={lay.bug.pos === p ? 'on' : undefined}
            onClick={() => set({ ...lay, bug: { ...lay.bug, pos: p } })} />
        ))}
        <small>Scorebug: {POS.find(([p]) => p === lay.bug.pos)![1].toLowerCase()}</small>
      </div>
      <label className="air-slide"><span>Stat card size<b>{pct(lay.cards.scale)}</b></span>
        <input type="range" min={CARD_SCALE.min} max={CARD_SCALE.max} step={0.05} value={lay.cards.scale}
          onChange={(e) => set({ ...lay, cards: { scale: Number(e.target.value) } }, 250)} />
      </label>
      {error && <p className="note note-bad" role="alert" style={{ margin: 12 }}>{error}</p>}
    </div>
  );
}
