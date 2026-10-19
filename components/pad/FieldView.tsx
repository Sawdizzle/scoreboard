'use client';

import { useRef, useState } from 'react';
import { shortName } from '@/lib/format';
import type { Lineup } from '@/lib/types';

type Base = 'first' | 'second' | 'third';
export type Who = { num: string; name: string } | null;
// Where a dragged runner was dropped: the base (1-3, or 4 for home) and
// whether he was safe there or out. Out at his own base is a pickoff there,
// the way GameChanger scores it; out at the next base is caught stealing.
export type Drop = { to: 1 | 2 | 3 | 4; safe: boolean };

// The field the way GameChanger draws it: the side in the field at their
// positions, the batter at the plate, the runners on their bases, and PITCH on
// the mound for everything the keys below do not cover. Places are % of the box.
const SPOT: Record<string, [number, number]> = {
  LF: [15, 18], CF: [50, 8], RF: [85, 18], SS: [29, 33], '2B': [71, 33], '3B': [12, 50], '1B': [88, 50], P: [50, 50], C: [50, 95],
};
const BASE_AT: Record<Base | 'home', [number, number]> = { first: [73, 63], second: [50, 37], third: [27, 63], home: [50, 84] };
const BASE_NO: Record<Base, 1 | 2 | 3> = { first: 1, second: 2, third: 3 };
const AT: Record<1 | 2 | 3 | 4, Base | 'home'> = { 1: 'first', 2: 'second', 3: 'third', 4: 'home' };
const BASE_NAME: Record<1 | 2 | 3 | 4, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: 'home' };

export function FieldView({ fieldLineup, runners, bases, batter, batColor, fieldColor, locked, onPitch, onBatter, onPitcher, onRunner, onDrop }: {
  fieldLineup?: Lineup;
  // Who is on each base (number and name), and whether the rules have someone there.
  runners: Record<Base, Who>; bases: Record<Base, boolean>;
  batter: Who; batColor: string; fieldColor: string; locked: boolean;
  onPitch: () => void; onBatter: () => void; onPitcher: () => void;
  // A tap on a runner, and a runner dragged onto a SAFE or OUT box.
  onRunner: (from: Base) => void; onDrop: (from: Base, d: Drop) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: Base; x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);
  const at = (pos: string): Who => {
    const bid = fieldLineup?.positions?.[pos];
    const b = bid ? fieldLineup?.batters?.find((x) => x.bid === bid) : undefined;
    return b ? { num: b.num, name: b.name } : null;
  };
  const place = ([x, y]: [number, number]) => ({ left: `${x}%`, top: `${y}%` });
  const local = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: React.PointerEvent, from: Base) {
    if (locked) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks: the drag still works without capture */ }
    const p = local(e);
    setDrag({ from, ...p, sx: e.clientX, sy: e.clientY, moved: false });
  }
  function move(e: React.PointerEvent) {
    if (!drag) return;
    const p = local(e);
    const moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 10;
    setDrag({ ...drag, ...p, moved });
  }
  function up(e: React.PointerEvent) {
    if (!drag) return;
    const { from, moved } = drag;
    setDrag(null);
    if (!moved) { onRunner(from); return; }
    const hit = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-drop]');
    if (!hit) return;
    const [to, safe] = (hit.dataset.drop ?? '').split(':');
    onDrop(from, { to: Number(to) as 1 | 2 | 3 | 4, safe: safe === 'safe' });
  }

  // While a runner is in the air: SAFE at every base he can get to (nobody in
  // his way; move the lead runner first), OUT at the base he was heading for
  // (caught stealing), and OUT just off his own base (picked off there).
  const order: Base[] = ['first', 'second', 'third'];
  const clear = (from: Base, n: number) => order.slice(BASE_NO[from], Math.min(n, 3)).every((k) => !bases[k]);
  const targets = drag?.moved
    ? ([2, 3, 4] as const).filter((n) => n > BASE_NO[drag.from]).map((n) => ({ n, safe: clear(drag.from, n), out: n === BASE_NO[drag.from] + 1 })).filter((t) => t.safe || t.out)
    : [];

  return (
    <div className={`fview${drag?.moved ? ' dragging' : ''}`} ref={box} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}
      style={{ '--bat': batColor, '--fld': fieldColor } as React.CSSProperties}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M50 99 L-6 33 A78 78 0 0 1 106 33 Z" className="fv-grass" />
        <path d="M50 94 L20 63 L50 29 L80 63 Z" className="fv-dirt" />
        <path d="M50 85 L27 63 L50 38 L73 63 Z" className="fv-infield" />
        <ellipse cx="50" cy="63" rx="7" ry="5" className="fv-dirt" />
      </svg>
      {(['first', 'second', 'third'] as const).map((k) => <i key={k} className={`fv-bag${bases[k] ? ' on' : ''}`} style={place(BASE_AT[k])} />)}
      <i className="fv-plate" style={place(BASE_AT.home)} />

      {Object.entries(SPOT).map(([pos, xy]) => {
        const f = at(pos);
        const label = <><b>{f?.num ? `#${f.num}` : pos}</b><small>{f ? `${pos} ${shortName(f.name)}`.trim() : ''}</small></>;
        return pos === 'P'
          ? <button key={pos} type="button" className="fv-fielder fv-p" style={place(xy)} onClick={onPitcher} aria-label={`Pitcher${f ? ` number ${f.num} ${f.name}` : ''}: pitching change`}>{label}</button>
          : <span key={pos} className="fv-fielder" style={place(xy)}>{label}</span>;
      })}

      <button type="button" className="fv-pitch" style={place([50, 63])} onClick={onPitch} disabled={locked} aria-label="Pitch: everything else (ball in play, hit by pitch, balk…)">PITCH</button>

      <button type="button" className="fv-batter" style={place([36, 86])} onClick={onBatter} aria-label={`At the plate${batter ? `: number ${batter.num} ${batter.name}` : ''}`}>
        <b>{batter?.num ? `#${batter.num}` : 'AB'}</b><small>{batter ? shortName(batter.name) || `No. ${batter.num}` : 'Set lineup'}</small>
      </button>

      {(['first', 'second', 'third'] as const).map((k) => bases[k] && (
        <button key={k} type="button" className={`fv-runner${drag?.from === k && drag.moved ? ' lifted' : ''}`} style={place(BASE_AT[k])}
          onPointerDown={(e) => down(e, k)} disabled={locked}
          aria-label={`Runner on ${k}${runners[k] ? `, number ${runners[k]!.num} ${runners[k]!.name}` : ''}. Tap for what he did, or drag him to a base`}>
          <b>{runners[k]?.num ? `#${runners[k]!.num}` : 'R'}</b><small>{runners[k] ? shortName(runners[k]!.name) : ''}</small>
        </button>
      ))}

      {targets.map(({ n, safe, out }) => (
        <div key={n} className="fv-drop" style={place(BASE_AT[AT[n]])}>
          {safe && <span data-drop={`${n}:safe`} className="fv-safe">SAFE<small>{BASE_NAME[n]}</small></span>}
          {out && <span data-drop={`${n}:out`} className="fv-out">OUT<small>{BASE_NAME[n]}</small></span>}
        </div>
      ))}
      {drag?.moved && (() => {
        const [x, y] = BASE_AT[drag.from];
        const n = BASE_NO[drag.from];
        return <>
          <div className="fv-drop" style={place([x, Math.max(y - 11, 6)])}>
            <span data-drop={`${n}:safe`} className="fv-safe">SAFE<small>back at {BASE_NAME[n]}</small></span>
          </div>
          <div className="fv-drop" style={place([x, Math.min(y + 11, 94)])}>
            <span data-drop={`${n}:out`} className="fv-out">OUT<small>at {BASE_NAME[n]}</small></span>
          </div>
        </>;
      })()}
      {drag?.moved && (
        <span className="fv-runner ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <b>{runners[drag.from]?.num ? `#${runners[drag.from]!.num}` : 'R'}</b>
        </span>
      )}
    </div>
  );
}
