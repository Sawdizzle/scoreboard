'use client';

import { useEffect, useState } from 'react';
import { clockSeconds, clockSet, clockStart, clockStop, clockText, type Clock } from '@/lib/broadcast';
import { browserClient } from '@/lib/supabase/browser';

// The game clock on the pad: a countdown (baseball's time limit, a football
// or basketball quarter) kept on games.clock, so every phone and the stream
// read the same instant. Starting and stopping it is not a play: Undo leaves
// it alone, as v4's did.
export function GameClock({ gameId, initial, fullSeconds, canRun, label = 'Clock', onChange }: {
  gameId: string; initial: Clock | null | undefined; fullSeconds: number; canRun: boolean; label?: string; onChange?: (c: Clock) => void;
}) {
  const sb = browserClient();
  const [clock, setClock] = useState<Clock | null>(initial ?? (fullSeconds ? clockSet('down', fullSeconds) : null));
  const [, tick] = useState(0);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!clock?.running) return;
    const t = window.setInterval(() => tick((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [clock?.running]);

  async function save(next: Clock) {
    const before = clock;
    setClock(next);
    setErr('');
    const { error } = await sb.from('games').update({ clock: next }).eq('id', gameId);
    if (error) { setClock(before); setErr('The clock did not save. Try again.'); return; }
    onChange?.(next);
  }
  function setTo() {
    const v = window.prompt('Set the clock (minutes, or m:ss)', clockText(clockSeconds(clock) ?? fullSeconds));
    if (v == null) return;
    const m = /^(\d{1,3})(?::(\d{1,2}))?$/.exec(v.trim());
    if (!m) return;
    void save(clockSet('down', Number(m[1]) * 60 + Number(m[2] ?? 0)));
  }

  const s = clockSeconds(clock);
  return (
    <div className="pclock" role="group" aria-label={label}>
      <span className="eyebrow">{label}</span>
      <b className={s !== null && s <= 60 && clock?.mode === 'down' ? 'low' : undefined}>{s === null ? '–:––' : clockText(s)}</b>
      <button type="button" className="btn btn-quiet" disabled={!canRun || !clock}
        onClick={() => clock && void save(clock.running ? clockStop(clock) : clockStart(clock))}>{clock?.running ? 'Stop' : 'Start'}</button>
      <button type="button" className="btn btn-ghost" disabled={!canRun} onClick={setTo}>Set</button>
      {fullSeconds > 0 && <button type="button" className="btn btn-ghost" disabled={!canRun} onClick={() => void save(clockSet('down', fullSeconds))}>Reset</button>}
      {err && <span className="bad">{err}</span>}
    </div>
  );
}
