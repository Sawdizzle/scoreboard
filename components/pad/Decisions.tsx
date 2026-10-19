'use client';

import { useEffect, useState } from 'react';
import { Sheet } from '@/components/pad/PadSheets';

// Our pitching decisions: a player id for each, or nobody.
export type Picks = { w: string | null; l: string | null; sv: string | null };
// Our pitchers in the order they first threw, the picks as they stand, and
// whether they are the scorer's own (or worked out from the plays).
export type Decided = { pitchers: string[]; picks: Picks; own: boolean };

// Pitching decisions at Game over, the way GameChanger asks for them before it
// finalizes: the win and the save in a win, the loss in a loss, filled in with
// what the plays worked out. "Keep these" leaves them worked out (GameChanger's
// Skip & finalize). A change is the scorer's own: it stands through an undo or
// a reopen until "Back to worked out".
export function Decisions({ load, result, nameOf, onSave, onClear, onClose }: {
  load: () => Promise<Decided | null>;
  result: 'won' | 'lost' | 'tied';
  nameOf: (bid: string | null) => string;
  onSave: (p: Picks) => Promise<string | null>;
  onClear: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [got, setGot] = useState<Decided | null>(null);
  const [picks, setPicks] = useState<Picks>({ w: null, l: null, sv: null });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void load().then((d) => {
      if (!live) return;
      if (d) { setGot(d); setPicks(d.picks); setErr(''); } else setErr('The pitching did not load. Check the signal and try again.');
    });
    return () => { live = false; };
  }, [load]);

  // Only what the result allows: a win and a save, or a loss.
  const now: Picks = result === 'won' ? { w: picks.w, l: null, sv: picks.w ? picks.sv : null } : result === 'lost' ? { w: null, l: picks.l, sv: null } : { w: null, l: null, sv: null };
  const was = got?.picks;
  const changed = !!was && (now.w !== was.w || now.l !== was.l || now.sv !== was.sv);
  const run = async (f: () => Promise<string | null>) => {
    setBusy(true);
    const e = await f();
    setBusy(false);
    if (e) setErr(e); else onClose();
  };
  const row = (label: string, key: keyof Picks, skip: string | null = null) => got && (
    <div className="stack" style={{ gap: 6 }}>
      <span className="legend">{label}</span>
      <div className="chips">
        {got.pitchers.filter((bid) => bid !== skip).map((bid) => (
          <button key={bid} type="button" className={`chip${picks[key] === bid ? ' on' : ''}`} aria-pressed={picks[key] === bid}
            onClick={() => setPicks({ ...picks, [key]: bid, ...(key === 'w' && picks.sv === bid ? { sv: null } : {}) })}>{nameOf(bid)}</button>
        ))}
        <button type="button" className={`chip${picks[key] ? '' : ' on'}`} aria-pressed={!picks[key]} onClick={() => setPicks({ ...picks, [key]: null })}>Nobody</button>
      </div>
    </div>
  );

  return (
    <Sheet title="Pitching decisions" onClose={onClose} close="Not now">
      {err && <p className="note note-bad">{err}</p>}
      {!got && !err && <p className="note note-plain">Loading the pitching…</p>}
      {got && !got.pitchers.length && <p className="note note-plain">No pitching of ours was scored in this game.</p>}
      {got && got.pitchers.length > 0 && result === 'tied' && <p className="note note-plain">A tie: no win or loss to give.</p>}
      {got && got.pitchers.length > 0 && result !== 'tied' && (
        <>
          <p className="hint">{got.own ? 'Your own picks. Back to worked out lets the plays decide again.' : 'Worked out from the plays. Change them if your league scores it another way.'}</p>
          {result === 'won' && row('Win', 'w')}
          {result === 'won' && picks.w && got.pitchers.length > 1 && row('Save', 'sv', picks.w)}
          {result === 'lost' && row('Loss', 'l')}
          <button type="button" className="btn btn-primary btn-big" disabled={busy}
            onClick={() => (changed ? void run(() => onSave(now)) : onClose())}>
            {busy ? 'Saving…' : changed ? 'Save decisions' : 'Keep these'}
          </button>
        </>
      )}
      {got?.own && <button type="button" className="link" disabled={busy} onClick={() => void run(onClear)}>Back to worked out</button>}
    </Sheet>
  );
}
