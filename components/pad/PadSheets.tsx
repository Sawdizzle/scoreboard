'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import * as L from '@/lib/rules/logic.js';
import { positionOf } from '@/lib/rules/roster.js';
import type { EngineSide, G } from '@/lib/scoring';
import type { Lineup, LineupBatter } from '@/lib/types';

// The pad's sheets. Each one is laid out for a thumb: big targets, the common
// answer first, and a Cancel that is always in the same place. They know the
// rules only to grey out what cannot have happened (with the reason), and hand
// the choice back to the pad, which records it.

export function Sheet({ title, onClose, children, close = 'Cancel' }: { title: string; onClose: () => void; children: React.ReactNode; close?: string }) {
  return (
    <div className="psheet-wrap" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="psheet">
        <div className="psheet-head">
          <h2>{title}</h2>
          <button type="button" className="link" onClick={onClose}>{close}</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Choice({ label, sub, onClick, why, tone }: { label: string; sub?: string; onClick: () => void; why?: string; tone?: string }) {
  return (
    <button type="button" className={`pchoice ${tone ?? ''}`} onClick={onClick} disabled={!!why} title={why || undefined}>
      <b>{label}</b>{(why || sub) && <small>{why || sub}</small>}
    </button>
  );
}

const FIELDERS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const DEST_LABEL: [number | 'out', string][] = [['out', 'Out'], [1, '1st'], [2, '2nd'], [3, '3rd'], [4, 'Home']];
// A runner can stay, move up, score or be out; never go back.
const START: Record<string, number> = { batter: 0, first: 1, second: 2, third: 3 };
const WHO: Record<string, string> = { batter: 'Batter', first: 'From 1st', second: 'From 2nd', third: 'From 3rd' };

// ---- Ball in play -------------------------------------------------------------
// GameChanger's order: how it was hit, what came of it, who fielded it (tapped
// in the order the ball went), then where everyone ended up. A home run is two
// taps, a hit with nobody on is two, a 6-3 groundout is four.
type Dest = Record<string, number | 'out'>;
export type InPlayResult = { kind: string; pos: string | null; dest: Dest; seq?: string[] | null; bb?: string | null; k3?: string | null; loc?: { x: number; y: number } | null };
// A hit asks where it went (for the spray chart), as GameChanger does.
const HITS = new Set(['H1', 'H2', 'H3']);
const HIT_TYPES: [string, string][] = [['GB', 'Ground ball'], ['HGB', 'Hard grounder'], ['LD', 'Line drive'], ['FB', 'Fly ball'], ['PU', 'Pop up'], ['BUNT', 'Bunt']];
// What can come of each: [kind, label]. 'OUT' is the plain out for that type.
const RESULTS: Record<string, [string, string][]> = {
  GB: [['OUT', 'Out at 1st'], ['FC', 'Fielder’s choice'], ['DP', 'Double play'], ['H1', 'Single'], ['H2', 'Double'], ['H3', 'Triple'], ['E', 'Error'], ['HR', 'Inside-the-park HR'], ['BI', 'B. Interference']],
  LD: [['OUT', 'Caught: line out'], ['DP', 'Double play'], ['H1', 'Single'], ['H2', 'Double'], ['H3', 'Triple'], ['HR', 'Home run'], ['E', 'Error']],
  FB: [['OUT', 'Caught: fly out'], ['SF', 'Sac fly'], ['DP', 'Double play'], ['H1', 'Single'], ['H2', 'Double'], ['H3', 'Triple'], ['HR', 'Home run'], ['E', 'Error']],
  PU: [['OUT', 'Caught: pop out'], ['DP', 'Double play'], ['H1', 'Single'], ['H2', 'Double'], ['E', 'Error']],
  BUNT: [['OUT', 'Out at 1st'], ['SAC', 'Sac bunt'], ['FC', 'Fielder’s choice'], ['DP', 'Double play'], ['H1', 'Single'], ['E', 'Error'], ['BI', 'B. Interference']],
};
RESULTS.HGB = RESULTS.GB;
// The out each type makes, as the rules know it.
const OUT_KIND: Record<string, string> = { GB: 'GB', HGB: 'GB', BUNT: 'GB', LD: 'LD', FB: 'FB', PU: 'PU' };
const NEEDS_FIELDER = new Set(['GB', 'FB', 'LD', 'PU', 'E', 'FC', 'DP', 'SF', 'SAC', 'K3']);
// Fielded by one player alone: a tap on him is the whole answer.
const ONE_FIELDER = new Set(['FB', 'LD', 'PU', 'SF', 'E']);

export function InPlay({ g, start, fieldLineup, onRecord, onInterference, onClose }: {
  g: G; fieldLineup?: Lineup;
  // Straight to a step: a key typed on a laptop (a hit), or a dropped third strike.
  start?: { kind: string; pos: string; batter?: number | 'out'; k3?: string | null; seq?: string[] };
  onRecord: (p: InPlayResult) => void;
  onInterference: () => void;
  onClose: () => void;
}) {
  const [bb, setBb] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(start?.kind ?? null);
  const [pos, setPos] = useState<string | null>(start?.pos ?? null);
  // The fielders in throw order, when the scorer gave more than one (6-4-3).
  const [seq, setSeq] = useState<string[]>(start?.seq ?? []);
  // Where it was fielded, and whether a hit's "where did it go" was answered.
  const [loc, setLoc] = useState<{ x: number; y: number } | null>(null);
  const [whereDone, setWhereDone] = useState(false);
  const [dest, setDest] = useState<Dest>(() => {
    if (!start) return {};
    const d = L.playDefaults(g, start.kind) as unknown as Dest;
    if (start.batter === 'out') { for (const k of Object.keys(d)) if (k !== 'batter') d[k] = START[k]; d.batter = 'out'; }
    return d;
  });
  const b = L.safeBases(g.bases);
  const anyone = b.first || b.second || b.third;
  const step = !kind ? (bb ? 'result' : 'type') : HITS.has(kind) && !whereDone ? 'where' : NEEDS_FIELDER.has(kind) && !pos ? 'fielder' : 'runners';
  const label = (k: string) => (L.PLAY_LABEL as Record<string, string>)[k] ?? k;
  const thrown = (s: string[]) => (s.length > 1 ? s : null);
  const record = (k: string, p: string | null, d: Dest, s: string[], at = loc) => onRecord({ kind: k, pos: p, dest: d, seq: thrown(s), bb, k3: start?.k3 ?? null, loc: at });

  function chooseResult(r: string) {
    if (r === 'BI') return onInterference();
    if (r === 'HR') return onRecord({ kind: 'HR', pos: null, dest: {}, bb });
    const k = r === 'OUT' ? OUT_KIND[bb!] : r;
    setKind(k);
    const d = L.playDefaults(g, k) as unknown as Dest;
    setDest(d);
    if (!NEEDS_FIELDER.has(k) && !HITS.has(k) && !anyone) record(k, null, d, []);
  }
  function chooseFielder(p: string, s: string[], at = loc) {
    setPos(p);
    if (!anyone) record(kind!, p, dest, s, at);
  }
  function fielders(next: string[]) {
    setSeq(next);
    if (ONE_FIELDER.has(kind!) && next.length === 1) chooseFielder(next[0], next);
  }
  // A fielder dragged to where he fielded it: he is the first in the sequence.
  function spotted(p: string, at: { x: number; y: number }) {
    setLoc(at);
    const s = seq[0] === p ? seq : [p, ...seq.slice(1).filter((x) => x !== p)];
    setSeq(s);
    if (ONE_FIELDER.has(kind!)) chooseFielder(p, s, at);
  }
  // Where a hit went: a fielder dragged there, a fielder tapped (his own spot),
  // or skipped.
  function where(at: { x: number; y: number } | null) {
    setLoc(at);
    setWhereDone(true);
    if (!anyone) record(kind!, null, dest, [], at);
  }
  // One fielder alone is the usual play for him (a ground ball to short is 6-3).
  const codeOf = (s: string[]) => (s.length > 1 ? L.seqCode(s, kind!) : L.playCode(kind!, s[0])) as string;
  const fieldCode = kind && seq.length ? codeOf(seq) : '';
  const res = kind ? L.resolvePlay(g, dest) as { outs: number; runs: number; clash: string | null } : null;
  const title = kind === 'K3' ? 'Dropped 3rd strike: where did everyone end up?'
    : step === 'type' ? 'Ball in play: how was it hit?'
      : step === 'result' ? `${HIT_TYPES.find(([k]) => k === bb)?.[1]}: what happened?`
        : step === 'where' ? `${label(kind!)}: where did it go?`
        : step === 'fielder' ? `${label(kind!)}: who fielded it?` : 'Where did everyone end up?';

  return (
    <Sheet title={title} onClose={onClose}>
      {step === 'type' && (
        <div className="pgrid three">
          {HIT_TYPES.map(([k, l]) => <Choice key={k} label={l} onClick={() => setBb(k)} tone={k === 'BUNT' ? '' : 'hit'} />)}
        </div>
      )}
      {step === 'result' && (
        <>
          <div className="pgrid two">
            {RESULTS[bb!].map(([r, l]) => {
              const k = r === 'OUT' ? OUT_KIND[bb!] : r;
              const why = r === 'BI' || r === 'HR' ? '' : L.playBlocked(g, k) as string;
              const tone = ['H1', 'H2', 'H3', 'HR'].includes(r) ? 'hit' : ['OUT', 'DP', 'SF', 'SAC', 'BI'].includes(r) ? 'strike' : '';
              return <Choice key={r} label={l} onClick={() => chooseResult(r)} why={why} tone={tone} />;
            })}
          </div>
          <button type="button" className="link" onClick={() => setBb(null)}>‹ How it was hit</button>
        </>
      )}
      {step === 'where' && (
        <>
          <FielderPicker lineup={fieldLineup} value={[]} kind={kind!} loc={loc}
            onChange={(s) => { const [x, y] = FIELD_SPOT[s[s.length - 1]] ?? [50, 50]; where({ x, y }); }}
            onLoc={(_, at) => where(at)} hint="Drag a fielder to where it went" />
          <button type="button" className="btn btn-quiet" onClick={() => where(null)}>Skip</button>
          {!start && <button type="button" className="link" onClick={() => { setKind(null); setLoc(null); }}>‹ What happened</button>}
        </>
      )}
      {step === 'fielder' && (
        <>
          <FielderPicker lineup={fieldLineup} value={seq} onChange={fielders} kind={kind!} loc={loc} onLoc={spotted} codeFor={codeOf}
            hint={ONE_FIELDER.has(kind!) ? (kind === 'E' ? 'Who made the error? Tap or drag' : 'Who caught it? Tap or drag') : 'Who fielded it (tap or drag), then the throw'} />
          {!ONE_FIELDER.has(kind!) && seq.length > 0 && (
            <button type="button" className="btn btn-primary btn-big" onClick={() => chooseFielder(seq[0], seq)}>
              {anyone ? 'Next' : 'Record'} · {label(kind!)} {fieldCode}
            </button>
          )}
          {!start && <button type="button" className="link" onClick={() => { setKind(null); setSeq([]); setLoc(null); }}>‹ What happened</button>}
        </>
      )}
      {step === 'runners' && (
        <>
          {(['batter', 'first', 'second', 'third'] as const).filter((k) => k === 'batter' || b[k]).map((k) => (
            <div key={k} className="prunner">
              <span className="legend">{WHO[k]}</span>
              <div className="pgrid five">
                {DEST_LABEL.filter(([d]) => d === 'out' || (d as number) >= Math.max(1, START[k])).map(([d, l]) => (
                  <button key={String(d)} type="button" className={`pdest${dest[k] === d ? ' on' : ''}`} aria-pressed={dest[k] === d}
                    onClick={() => setDest({ ...dest, [k]: d })}>{l}</button>
                ))}
              </div>
            </div>
          ))}
          {res?.clash && <p className="note note-bad">Two runners end on {res.clash}. Move one of them.</p>}
          <button type="button" className="btn btn-primary btn-big" disabled={!!res?.clash}
            onClick={() => record(kind!, pos, dest, seq)}>
            Record{res ? ` · ${res.outs ? `${res.outs} out${res.outs > 1 ? 's' : ''}` : 'no outs'}${res.runs ? `, ${res.runs} run${res.runs > 1 ? 's' : ''}` : ''}` : ''}
          </button>
        </>
      )}
    </Sheet>
  );
}

// ---- Fielders, in the order the ball went ------------------------------------
// A small field with the nine positions on it, each with the number of the kid
// standing there. Tap them in the order the ball went: the catcher then the
// third baseman is a 2-5 pickoff. The usual sequence comes pre-filled (`value`
// as given); the first tap starts the scorer's own.
const FIELD_SPOT: Record<string, [number, number]> = {
  LF: [17, 21], CF: [50, 11], RF: [83, 21], SS: [35, 43], '2B': [65, 43], '3B': [22, 63], '1B': [78, 63], P: [50, 62], C: [50, 88],
};
export function FielderPicker({ lineup, value, onChange, kind = '', hint, given = 'usual', loc, onLoc, codeFor }: {
  lineup?: Lineup; value: string[]; onChange: (seq: string[]) => void; kind?: string; hint?: string;
  // The code the sequence makes, when it is not the plain one (In Play: one fielder alone is his usual play).
  codeFor?: (seq: string[]) => string;
  // What the pre-filled sequence is: the usual throw, or the one scored.
  given?: string;
  // Where the ball was fielded, for a spray chart: GameChanger's "Tap & Drag
  // Fielder". Dragging a fielder to a spot says he fielded it there.
  loc?: { x: number; y: number } | null;
  onLoc?: (pos: string, at: { x: number; y: number }) => void;
}) {
  const [mine, setMine] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ pos: string; x: number; y: number; sx: number; sy: number; moved: boolean } | null>(null);
  // A drag ends in a click on the button it started from: that click is not a tap.
  const dragged = useRef(false);
  const pct = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)) };
  };
  const down = (e: React.PointerEvent, pos: string) => {
    if (!onLoc) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the drag still works without capture */ }
    setDrag({ pos, ...pct(e), sx: e.clientX, sy: e.clientY, moved: false });
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    setDrag({ ...drag, ...pct(e), moved: drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 10 });
  };
  const up = () => {
    if (!drag) return;
    if (drag.moved && onLoc) { dragged.current = true; onLoc(drag.pos, { x: drag.x, y: drag.y }); setMine(true); }
    setDrag(null);
  };
  const numOf = (pos: string) => {
    const bid = lineup?.positions?.[pos];
    const b = bid ? lineup?.batters?.find((x) => x.bid === bid) : undefined;
    return b?.num ? `#${b.num}` : '';
  };
  const tap = (pos: string) => { onChange(mine ? [...value, pos].slice(0, 6) : [pos]); setMine(true); };
  const code = value.length ? (codeFor ? codeFor(value) : L.seqCode(value, kind) as string) : '';
  return (
    <div className="fpick">
      <div className={`fpick-field${onLoc ? ' can-drag' : ''}${drag?.moved ? ' dragging' : ''}`} ref={box}
        onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M50 97 L4 34 A62 62 0 0 1 96 34 Z" className="fp-grass" />
          <path d="M50 92 L28 66 L50 44 L72 66 Z" className="fp-dirt" />
        </svg>
        {FIELDERS.map((pos) => {
          const at = value.flatMap((p, i) => (p === pos ? [i + 1] : []));
          const [x, y] = FIELD_SPOT[pos];
          return (
            <button key={pos} type="button" className={`fpick-spot${at.length ? ' on' : ''}${at.length && !mine ? ' guess' : ''}${drag?.pos === pos && drag.moved ? ' lifted' : ''}`} style={{ left: `${x}%`, top: `${y}%` }}
              onPointerDown={(e) => down(e, pos)}
              onClick={() => { if (dragged.current) { dragged.current = false; return; } tap(pos); }}
              aria-label={`${pos}${numOf(pos) ? `, number ${numOf(pos).slice(1)}` : ''}${at.length ? `, step ${at.join(' and ')}` : ''}`}>
              <b>{(L.POS_NUM as Record<string, number>)[pos]}</b><small>{pos}</small>{numOf(pos) && <em>{numOf(pos)}</em>}
              {at.length > 0 && <i>{at.join('·')}</i>}
            </button>
          );
        })}
        {loc && !drag?.moved && <i className="fpick-ball" style={{ left: `${loc.x}%`, top: `${loc.y}%` }} aria-hidden="true" />}
        {drag?.moved && <i className="fpick-ball moving" style={{ left: `${drag.x}%`, top: `${drag.y}%` }} aria-hidden="true" />}
      </div>
      <div className="fpick-bar">
        <span className="fpick-code">{code ? <>{code}{!mine && <small> · {given}, tap to change</small>}</> : <span className="fpick-hint">{hint ?? 'Tap the fielders in the order the ball went'}</span>}</span>
        <button type="button" className="icon-btn" aria-label="Take back the last fielder" disabled={!value.length} onClick={() => { onChange(value.slice(0, -1)); setMine(true); }}>⌫</button>
      </div>
    </div>
  );
}

// PITCH, on the mound: everything the keys below the field do not cover, the
// way GameChanger's pitch menu does it. Ball in play leads; batter's
// interference and "batter out" live here too, so nobody has to fake a
// strikeout to move the order on; a dropped third strike appears with two
// strikes on the batter.
type Other = 'hbp' | 'ci' | 'ibb' | 'balk';
export function PitchMenu({ g, fieldLineup, onInPlay, onPick, onFoulTip, onInterference, onBatterOut, onDropped, onClose }: {
  g: G; fieldLineup?: Lineup; onInPlay: () => void; onPick: (k: Other) => void;
  // Strike three on a foul tip the catcher held: a swinging strikeout.
  onFoulTip: () => void;
  // Batter's interference: on a play at a runner (his base) or with no play on a runner (null).
  onInterference: (from: 'first' | 'second' | 'third' | null) => void;
  onBatterOut: (seq: string[]) => void;
  // A dropped third strike: safe at first on a wild pitch or a passed ball, or thrown out (with the throw).
  onDropped: (how: 'WP' | 'PB' | 'out', seq: string[]) => void;
  onClose: () => void;
}) {
  const b = L.safeBases(g.bases);
  const on = (['first', 'second', 'third'] as const).filter((k) => b[k]);
  const [step, setStep] = useState<null | 'bi' | 'out' | 'k3' | 'k3out'>(null);
  const [seq, setSeq] = useState<string[]>(['C']);
  const k3 = L.playBlocked(g, 'K3') as string;
  if (step === 'bi') return (
    <Sheet title="Batter’s interference" onClose={onClose}>
      <p className="hint">The batter is out. With a play on a runner, that runner goes back, unless it was a play at home with fewer than 2 outs: then the runner is out and the batter stays up.</p>
      <div className="pgrid two">
        <Choice label="No play on a runner" sub="Batter out, catcher’s putout" onClick={() => onInterference(null)} tone="strike" />
        {on.map((k) => (
          <Choice key={k} label={`Play on the runner at ${k === 'first' ? '1st' : k === 'second' ? '2nd' : '3rd'}`}
            sub={k === 'third' && (g.outs | 0) < 2 ? 'Runner out at home' : 'Runner goes back'} onClick={() => onInterference(k)} />
        ))}
      </div>
      <button type="button" className="link" onClick={() => setStep(null)}>‹ Back</button>
    </Sheet>
  );
  if (step === 'out') return (
    <Sheet title="Batter out" onClose={onClose}>
      <p className="hint">Out of the box, hit by his own ball, an illegal bat, batting out of order: an at-bat and an out, no pitch. Who made the out?</p>
      <FielderPicker lineup={fieldLineup} value={seq} onChange={setSeq} kind="BO" hint="Who made the out (optional)" />
      <button type="button" className="btn btn-primary btn-big" onClick={() => onBatterOut(seq)}>Record · batter out{seq.length ? ` ${L.seqCode(seq, 'BO')}` : ''}</button>
      <button type="button" className="link" onClick={() => setStep(null)}>‹ Back</button>
    </Sheet>
  );
  if (step === 'k3') return (
    <Sheet title="Dropped 3rd strike" onClose={onClose}>
      <p className="hint">A strikeout for the batter and the pitcher either way.</p>
      <div className="pgrid two">
        <Choice label="Safe at 1st" sub="Wild pitch" onClick={() => onDropped('WP', [])} tone="hit" />
        <Choice label="Safe at 1st" sub="Passed ball" onClick={() => onDropped('PB', [])} tone="hit" />
      </div>
      <Choice label="Out at 1st" sub="Pick the throw (2-3)" onClick={() => { setSeq(['C', '1B']); setStep('k3out'); }} tone="strike" />
      <button type="button" className="link" onClick={() => setStep(null)}>‹ Back</button>
    </Sheet>
  );
  if (step === 'k3out') return (
    <Sheet title="Dropped 3rd strike: out at 1st" onClose={onClose}>
      <FielderPicker lineup={fieldLineup} value={seq} onChange={setSeq} kind="K3" />
      <button type="button" className="btn btn-primary btn-big" onClick={() => onDropped('out', seq)}>Record · strikeout {L.seqCode(seq, 'K3')}</button>
      <button type="button" className="link" onClick={() => setStep('k3')}>‹ Back</button>
    </Sheet>
  );
  return (
    <Sheet title="Pitch" onClose={onClose}>
      <button type="button" className="btn btn-primary btn-big" onClick={onInPlay}>Ball in play</button>
      <span className="legend">The batter</span>
      <div className="pgrid two">
        <Choice label="Hit by pitch" onClick={() => onPick('hbp')} />
        <Choice label="Intentional walk" onClick={() => onPick('ibb')} />
        <Choice label="Catcher’s interference" sub="Batter to 1st" onClick={() => onPick('ci')} />
        <Choice label="Batter’s interference" sub="Batter out" onClick={() => (on.length ? setStep('bi') : onInterference(null))} tone="strike" />
        <Choice label="Batter out" sub="Out of the box, illegal bat…" onClick={() => setStep('out')} tone="strike" />
        {(g.strikes | 0) >= 2 && <Choice label="Foul tip out" sub="Strikeout, the catcher held it" onClick={onFoulTip} tone="strike" />}
        {(g.strikes | 0) >= 2 && <Choice label="Dropped 3rd strike" sub={k3 || 'Batter runs'} onClick={() => setStep('k3')} why={k3} />}
      </div>
      <span className="legend">The pitcher</span>
      <div className="pgrid two">
        <Choice label="Balk" sub="Every runner moves up" onClick={() => onPick('balk')} why={on.length ? '' : 'Nobody on: a balk is a ball'} />
      </div>
      <p className="hint">Steals, pickoffs, wild pitches and passed balls: drag the runner to a SAFE or OUT box, or tap him.</p>
    </Sheet>
  );
}

// The Game Menu, as GameChanger keeps it top left: fixes, the end of a half or
// of the game, the lineups, and leaving.
export function GameMenu({ final, lineupHref, gameHref, layout, onLayout, sun, onSun, home, onSwap, onDecide, onFix, onPlays, onEndHalf, onEnd, onClose }: {
  final: boolean; lineupHref: string; gameHref: string; layout: 'field' | 'keys'; onLayout: (l: 'field' | 'keys') => void;
  // Sunlight: the high-contrast pad, per phone.
  sun: boolean; onSun: (on: boolean) => void;
  // Swap home and away: offered only before the first pitch.
  home: boolean; onSwap?: () => void;
  // The pitching decisions, once the game is final.
  onDecide?: () => void;
  onFix: () => void; onPlays: () => void; onEndHalf: () => void; onEnd: () => void; onClose: () => void;
}) {
  return (
    <Sheet title="Game menu" onClose={onClose} close="Done">
      <div className="menu-list">
        <button type="button" className="menu-row" onClick={onFix}><b>Fix the situation</b><small>Score, inning, outs, count, bases, pitch count</small></button>
        <button type="button" className="menu-row" onClick={onPlays}><b>Plays</b><small>Every play so far: fix who was credited, or the fielders</small></button>
        {!final && <button type="button" className="menu-row" onClick={onEndHalf}><b>End half inning</b><small>A max-runs rule, or a third out the keys missed</small></button>}
        {onDecide && <button type="button" className="menu-row" onClick={onDecide}><b>Pitching decisions</b><small>Win, loss and save: worked out, or your own</small></button>}
        <button type="button" className={`menu-row${final ? '' : ' bad'}`} onClick={onEnd}><b>{final ? 'Reopen the game' : 'Game over'}</b><small>{final ? 'To fix a play' : 'End the game: stats count, the stream shows Final'}</small></button>
        <Link href={lineupHref} className="menu-row"><b>Lineups</b><small>Order, positions, subs, both teams</small></Link>
        {onSwap && <button type="button" className="menu-row" onClick={onSwap}><b>Swap home and away</b><small>We are {home ? 'home' : 'away'}: make us {home ? 'away' : 'home'}. Before the first pitch only</small></button>}
        <Link href={gameHref} className="menu-row"><b>Leave the pad</b><small>To the game page</small></Link>
      </div>
      <span className="legend">On this phone</span>
      <div className="seg" role="radiogroup" aria-label="Pad layout">
        <button type="button" role="radio" aria-checked={layout === 'field'} className="seg-item" aria-current={layout === 'field' ? 'page' : undefined} onClick={() => onLayout('field')}>The field</button>
        <button type="button" role="radio" aria-checked={layout === 'keys'} className="seg-item" aria-current={layout === 'keys' ? 'page' : undefined} onClick={() => onLayout('keys')}>Big keys</button>
      </div>
      <div className="seg" role="radiogroup" aria-label="Screen colours">
        <button type="button" role="radio" aria-checked={!sun} className="seg-item" aria-current={!sun ? 'page' : undefined} onClick={() => onSun(false)}>Dark</button>
        <button type="button" role="radio" aria-checked={sun} className="seg-item" aria-current={sun ? 'page' : undefined} onClick={() => onSun(true)}>☀ Sunlight</button>
      </div>
    </Sheet>
  );
}

// A runner on base: tapped, or dragged to a SAFE or OUT box (`drop`), the way
// GameChanger does it. Safe asks how he got there; out asks how he was put out,
// then who made the play in throw order (a pickoff from the catcher to third
// is 2-5), with the usual throw filled in. An error asks who made it.
type RunnerKind = 'SB' | 'WP' | 'PB' | 'EA' | 'DI' | 'OBS' | 'ADV' | 'OLP' | 'APO' | 'CS' | 'PO' | 'RO';
// Who can come in for a runner: the bench (ours), or anyone typed in (theirs);
// a courtesy runner may also be someone in the order (often the last out).
export type RunnerSubs = { bench: LineupBatter[] | null; order: LineupBatter[] };
export function Runner({ g, from, who, drop, fieldLineup, subs, onPick, onSub, onInterference, onClose }: {
  g: G; from: 'first' | 'second' | 'third'; who: string; fieldLineup?: Lineup;
  drop?: { to: 1 | 2 | 3 | 4; safe: boolean };
  subs?: RunnerSubs;
  onPick: (k: RunnerKind, opts: { seq?: string[]; to?: number; why?: string }) => void;
  onSub?: (kind: 'PR' | 'CR', kid: LineupBatter | { num: string; name: string }) => void;
  onInterference: () => void;
  onClose: () => void;
}) {
  const start = from === 'first' ? 1 : from === 'second' ? 2 : 3;
  const [to, setTo] = useState<number>(drop && drop.to > start ? drop.to : start + 1);
  // Dropped out at his own base: picked off there. At the next base: caught stealing.
  const atOwn = !!drop && !drop.safe && drop.to === start;
  const atNext = !!drop && !drop.safe && drop.to > start;
  const [ask, setAsk] = useState<null | { kind: 'CS' | 'PO' | 'RO' | 'EA'; why?: string }>(null);
  const [seq, setSeq] = useState<string[]>([]);
  const [subKind, setSubKind] = useState<null | 'PR' | 'CR'>(null);
  const [typed, setTyped] = useState({ num: '', name: '' });
  const backOnOwn = !!drop && drop.safe && drop.to === start;
  const baseName = (n: number) => (n >= 4 ? 'home' : n === 3 ? '3rd' : '2nd');
  const fromName = from === 'first' ? '1st' : from === 'second' ? '2nd' : '3rd';
  const label: Record<RunnerKind, string> = (L.RUNNER_LABEL as Record<RunnerKind, string>);
  const blocked = (k: RunnerKind) => L.runnerBlocked(g, from, k, to) as string;
  const open = (kind: 'CS' | 'PO' | 'RO' | 'EA', why?: string) => { setSeq(kind === 'EA' || kind === 'RO' ? [] : (L.runnerSeqGuess(kind, from) as string[])); setAsk({ kind, why }); };
  if (ask) {
    const k = ask.kind;
    const code = L.seqCode(seq, k) as string;
    const name = ask.why ? `Out · ${ask.why}` : label[k];
    return (
      <Sheet title={`${name}${who ? ` · ${who}` : ''}`} onClose={onClose}>
        <FielderPicker lineup={fieldLineup} value={seq} onChange={setSeq} kind={k}
          hint={k === 'EA' ? 'Who made the error? (a throw first, then the fielder who missed it)' : k === 'RO' ? 'Who made the out, in order (optional)' : undefined} />
        <button type="button" className="btn btn-primary btn-big" disabled={k === 'EA' && !seq.length}
          onClick={() => onPick(k, { seq, ...(k === 'EA' ? { to } : {}), ...(ask.why ? { why: ask.why } : {}) })}>
          Record · {name}{code ? ` ${code}` : ''}{k === 'EA' ? `, to ${baseName(to)}` : ''}
        </button>
        <button type="button" className="link" onClick={() => setAsk(null)}>‹ Back</button>
      </Sheet>
    );
  }
  if (subKind && subs && onSub) {
    const pinch = subKind === 'PR';
    // Not the runner himself, nor the batter at the plate.
    const order = subs.order.filter((b) => b.name || b.num);
    const pick = (b: LineupBatter) => onSub(subKind, b);
    return (
      <Sheet title={`${pinch ? 'Pinch runner' : 'Courtesy runner'} for ${who || `the runner on ${fromName}`}`} onClose={onClose}>
        <p className="hint">{pinch ? 'He takes this runner’s place in the order too; the runner leaves the game.' : 'Only on the bases: the runner stays in the game and in the order.'}</p>
        {subs.bench && !subs.bench.length && pinch && <p className="note note-plain">Nobody on the bench. Add a player on the lineup screen first, or use a courtesy runner.</p>}
        {subs.bench && subs.bench.length > 0 && <>
          <span className="legend">Bench</span>
          <div className="chips">{subs.bench.map((b) => <button key={b.bid} type="button" className="chip" onClick={() => pick(b)}>{b.num && `#${b.num} `}{b.name}</button>)}</div>
        </>}
        {!pinch && order.length > 0 && <>
          <span className="legend">In the order</span>
          <div className="chips">{order.map((b) => <button key={b.bid} type="button" className="chip" onClick={() => pick(b)}>{b.num && `#${b.num} `}{b.name}</button>)}</div>
        </>}
        {!subs.bench && (
          <div className="field-row atbat-two" style={{ gridTemplateColumns: '84px 1fr auto' }}>
            <label className="field"><span>No.</span><input className="input" inputMode="numeric" value={typed.num} maxLength={3}
              onChange={(e) => setTyped({ ...typed, num: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label>
            <label className="field"><span>Name</span><input className="input" value={typed.name} maxLength={60} onChange={(e) => setTyped({ ...typed, name: e.target.value })} /></label>
            <button type="button" className="btn btn-quiet" style={{ alignSelf: 'end' }} disabled={!typed.num && !typed.name.trim()} onClick={() => onSub(subKind, { num: typed.num, name: typed.name.trim() })}>Run</button>
          </div>
        )}
        <button type="button" className="link" onClick={() => setSubKind(null)}>‹ Back</button>
      </Sheet>
    );
  }
  if (backOnOwn) return (
    <Sheet title={`Safe at ${fromName}: how?`} onClose={onClose}>
      <div className="pgrid two">
        <Choice label="Pickoff attempt" sub="Thrown over, safe back" onClick={() => onPick('APO', {})} />
        <Choice label="Nothing happened" sub="Leave him there" onClick={onClose} />
      </div>
    </Sheet>
  );
  const go = (k: RunnerKind, why?: string) => onPick(k, { to, ...(why ? { why } : {}) });
  const safe = !drop || drop.safe, out = !drop || !drop.safe;
  return (
    <Sheet title={drop ? (drop.safe ? `Safe at ${baseName(to)}: how?` : `Out at ${atOwn ? fromName : baseName(drop.to)}: how?`) : `Runner on ${fromName}${who ? ` · ${who}` : ''}`} onClose={onClose}>
      {safe && start < 3 && !drop && (
        <div className="seg" role="radiogroup" aria-label="Moved up to">
          {[2, 3, 4].filter((n) => n > start).map((n) => (
            <button key={n} type="button" role="radio" aria-checked={to === n} className="seg-item" aria-current={to === n ? 'page' : undefined} onClick={() => setTo(n)}>To {baseName(n)}</button>
          ))}
        </div>
      )}
      {safe && <>
        <span className="legend">{drop ? `${who || 'The runner'} from ${fromName} to ${baseName(to)}` : `Moved up${start < 3 ? ` to ${baseName(to)}` : ' to score'}`}</span>
        <div className="pgrid three">
          <Choice label={to >= 4 ? 'Stole home' : `Stole ${baseName(to)}`} onClick={() => go('SB')} why={blocked('SB')} tone="hit" />
          <Choice label="Wild pitch" onClick={() => go('WP')} why={blocked('WP')} />
          <Choice label="Passed ball" onClick={() => go('PB')} why={blocked('PB')} />
          <Choice label="Error" sub="Pick the fielder" onClick={() => open('EA')} why={blocked('EA')} />
          <Choice label="Indifference" sub="No throw: no steal" onClick={() => go('DI')} why={blocked('DI')} />
          <Choice label="On the throw" sub="Took the base on a throw" onClick={() => go('ADV', 'on the throw')} why={blocked('ADV')} />
          <Choice label="On the last play" sub="RBI to that batter if he scores" onClick={() => go('OLP')} why={blocked('OLP')} />
          <Choice label="Obstruction" sub="Awarded the base" onClick={() => go('OBS')} why={blocked('OBS')} />
          <Choice label="Other" sub="No one charged" onClick={() => go('ADV', 'other')} why={blocked('ADV')} />
        </div>
      </>}
      {out && <>
        <span className="legend">{drop ? `${who || 'The runner'} from ${fromName}` : 'Out'}</span>
        <div className="pgrid three">
          {!atOwn && <Choice label="Caught stealing" sub="Pick the throw" onClick={() => open('CS')} tone="strike" />}
          {!atNext && <Choice label="Picked off" sub="Pick the throw" onClick={() => open('PO')} tone="strike" />}
          <Choice label="Interference" sub="Runner’s" onClick={() => open('RO', 'runner’s interference')} tone="strike" />
          <Choice label="Out on appeal" sub="Left early, missed a base" onClick={() => open('RO', 'appeal')} tone="strike" />
          <Choice label="Other" sub="Pick who made it" onClick={() => open('RO')} tone="strike" />
        </div>
        <Choice label="Batter’s interference" sub="On a play on this runner" onClick={onInterference} />
      </>}
      {!drop && subs && onSub && <>
        <span className="legend">Substitute</span>
        <div className="pgrid two">
          <Choice label="Pinch runner" sub="Replaces him in the order" onClick={() => setSubKind('PR')} />
          <Choice label="Courtesy runner" sub="He stays in the game" onClick={() => setSubKind('CR')} />
        </div>
      </>}
    </Sheet>
  );
}

// The scoring check at End game: what in the log looks like a slip. Fix opens
// the Situation sheet; End anyway ends the game as it stands.
export function EndCheck({ issues, onFix, onEnd, onClose }: {
  issues: { level: 'fix' | 'note'; text: string }[]; onFix: () => void; onEnd: () => void; onClose: () => void;
}) {
  const fixes = issues.filter((i) => i.level === 'fix').length;
  return (
    <Sheet title={fixes ? `${fixes} thing${fixes === 1 ? '' : 's'} to fix before the end` : 'Check before the end'} onClose={onClose}>
      <ul className="stack" style={{ gap: 8, margin: 0, paddingLeft: 18 }}>
        {issues.map((i, n) => <li key={n} className={i.level === 'fix' ? 'note note-bad' : 'note note-plain'} style={{ listStyle: 'none', marginLeft: -18 }}>{i.text}</li>)}
      </ul>
      <p className="hint">Stats and recaps come from these plays. Undo back to a slip and score it again, or fix the score on the Situation sheet.</p>
      <div className="pgrid two">
        <button type="button" className="btn btn-quiet btn-big" onClick={onFix}>Go back and fix</button>
        <button type="button" className="btn btn-danger btn-big" onClick={onEnd}>End anyway</button>
      </div>
    </Sheet>
  );
}

// End game, from its own button on the bar or the game-over offer: the score
// as it stands, and one big button. A final game offers Reopen instead.
export function EndGame({ final, score, when, ending, onEnd, onReopen, onClose }: {
  final: boolean; score: string; when: string; ending: boolean; onEnd: () => void; onReopen: () => void; onClose: () => void;
}) {
  return (
    <Sheet title={final ? 'This game is final' : 'End the game?'} onClose={onClose}>
      <div className="end-score"><b>{score}</b><small>{when}</small></div>
      {final ? (
        <>
          <p className="hint">Reopen to fix a play. End it again when you are done: stats and the recap come from the plays.</p>
          <button type="button" className="btn btn-quiet btn-big" onClick={onReopen}>Reopen the game</button>
        </>
      ) : (
        <>
          <p className="hint">Stats count, pitching decisions are worked out and the stream shows Final. You can reopen it later.</p>
          <button type="button" className="btn btn-danger btn-big" onClick={onEnd} disabled={ending} aria-busy={ending}>
            {ending ? 'Checking the scoring…' : 'End game'}
          </button>
        </>
      )}
    </Sheet>
  );
}

// A pitching change, without leaving the pad: the fielding side's order, the
// pitcher now marked in it. A tap puts that player on the mound and sends the
// one coming off to his old spot. Their pitcher may not be on the card at all:
// type his number.
export function Pitching({ g, side, labels, locked, lineupHref, counts, onPick, onClose }: {
  g: G; side: EngineSide; labels: Record<EngineSide, string>; locked: boolean;
  // Pitch counts by inning, GameChanger's other choice on the pitcher's card.
  counts?: React.ReactNode;
  lineupHref: (side: EngineSide) => string;
  onPick: (side: EngineSide, pick: { bid: string } | { num: string }) => Promise<string | null>;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<EngineSide>(side);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [num, setNum] = useState('');
  const [view, setView] = useState<'change' | 'counts'>('change');
  const lineup = g.lineups[shown];
  const batters = lineup?.batters ?? [];
  const now = lineup?.positions?.P ?? null;
  const pick = async (key: string, p: { bid: string } | { num: string }) => {
    setBusy(key); setErr('');
    const e = await onPick(shown, p);
    setBusy('');
    if (e) setErr(e);
  };
  return (
    <Sheet title={view === 'counts' ? 'Pitch counts' : 'Pitching change'} onClose={onClose} close="Done">
      {counts && (
        <div className="seg" role="tablist" aria-label="Pitcher">
          <button type="button" role="tab" aria-selected={view === 'change'} className="seg-item" aria-current={view === 'change' ? 'page' : undefined} onClick={() => setView('change')}>Pitching change</button>
          <button type="button" role="tab" aria-selected={view === 'counts'} className="seg-item" aria-current={view === 'counts' ? 'page' : undefined} onClick={() => setView('counts')}>Pitch counts</button>
        </div>
      )}
      {view === 'counts' ? counts : <>
      <div className="pgrid two" role="tablist">
        {(['away', 'home'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={shown === s} className={`pchoice${shown === s ? ' on' : ''}`} onClick={() => { setShown(s); setErr(''); }}>
            <b>{labels[s]}</b><small>{s === side ? 'In the field' : 'Batting'}</small>
          </button>
        ))}
      </div>
      <p className="eyebrow">Tap who is pitching now</p>
      {err && <p className="note note-bad">{err}</p>}
      {!batters.length && <p className="note note-plain">No lineup yet for {labels[shown]}. Type the pitcher&apos;s number below.</p>}
      <div className="atbat-list">
        {batters.map((b, i) => {
          const on = b.bid === now;
          return (
            <div key={b.bid} className={`atbat-row${on ? ' on' : ''}`}>
              <button type="button" className="atbat-pick" disabled={locked || on || !!busy || !(b.num || b.name)} onClick={() => pick(b.bid, { bid: b.bid })}>
                <span className="atbat-slot">{i + 1}</span>
                <span className="atbat-num">{b.num ? `#${b.num}` : '–'}</span>
                <span className="atbat-name">{b.name || (b.num ? `No. ${b.num}` : 'Empty slot')}<small>{positionOf(lineup, i) || ''}</small></span>
                {on ? <span className="tag live">Pitching</span> : busy === b.bid ? <span className="tag">Saving…</span> : null}
              </button>
            </div>
          );
        })}
      </div>
      {!locked && (
        <div className="field-row atbat-two" style={{ gridTemplateColumns: '1fr auto' }}>
          <label className="field"><span>Not in the order: their number</span>
            <input className="input" inputMode="numeric" value={num} maxLength={3} onChange={(e) => setNum(e.target.value.replace(/\D/g, '').slice(0, 3))} /></label>
          <button type="button" className="btn btn-quiet" style={{ alignSelf: 'end' }} disabled={!num || !!busy}
            onClick={async () => { await pick('num', { num }); setNum(''); }}>{busy === 'num' ? 'Saving…' : 'Pitch'}</button>
        </div>
      )}
      <Link href={lineupHref(shown)} className="link" style={{ alignSelf: 'center' }}>Order, subs and positions: lineup ›</Link>
      </>}
    </Sheet>
  );
}

// Corrections, and ending the game. Nothing here goes on anyone's stats.
// The demo and Start over sit folded at the bottom, away from a thumb.
export function Situation({ g, final, labels, extra, practice, ending = false, onFix, onEnd, onStartOver, onClose }: {
  g: G; final: boolean; labels: { away: string; home: string }; extra?: React.ReactNode; practice?: React.ReactNode;
  // The scoring check is running: End game waits for it (4 s at most).
  ending?: boolean;
  onFix: (res: unknown) => void; onEnd: (final: boolean) => void; onStartOver: () => void; onClose: () => void;
}) {
  const b = L.safeBases(g.bases);
  const step = (label: string, value: string | number, minus: () => unknown, plus: () => unknown) => (
    <div className="pstep">
      <span>{label}</span>
      <button type="button" className="icon-btn" aria-label={`${label} down`} onClick={() => onFix(minus())}>−</button>
      <b>{value}</b>
      <button type="button" className="icon-btn" aria-label={`${label} up`} onClick={() => onFix(plus())}>+</button>
    </div>
  );
  return (
    <Sheet title="Fix the situation" onClose={onClose}>
      {extra}
      <div className="stack" style={{ gap: 4 }}>
        {step(labels.away, g.away_score, () => L.adjustScore(g, 'away', -1), () => L.adjustScore(g, 'away', 1))}
        {step(labels.home, g.home_score, () => L.adjustScore(g, 'home', -1), () => L.adjustScore(g, 'home', 1))}
        {step('Inning', `${g.half === 'top' ? '▲' : '▼'} ${g.inning}`, () => L.onNudgeInning(g, -1), () => L.onNudgeInning(g, 1))}
        {/* The third out ends the half, as it does on the keys: count and bases
            cleared, the other side up. Outs held at 3 left the next play to end it. */}
        {step('Outs', g.outs, () => L.adjustOuts(g, -1), () => ((g.outs | 0) >= 2 ? L.onEndHalf(g) : L.adjustOuts(g, 1)))}
        {step('Balls', g.balls, () => L.adjustBalls(g, -1), () => L.adjustBalls(g, 1))}
        {step('Strikes', g.strikes, () => L.adjustStrikes(g, -1), () => L.adjustStrikes(g, 1))}
        {step('Pitch count', L.pitchCount(g), () => L.adjustPitch(g, -1), () => L.adjustPitch(g, 1))}
      </div>
      <details className="fold">
        <summary>Hits and errors</summary>
        <div className="stack" style={{ gap: 4 }}>
          {step(`${labels.away} hits`, Number(g.away_hits) | 0, () => L.adjustHits(g, 'away', -1), () => L.adjustHits(g, 'away', 1))}
          {step(`${labels.home} hits`, Number(g.home_hits) | 0, () => L.adjustHits(g, 'home', -1), () => L.adjustHits(g, 'home', 1))}
          {step(`${labels.away} errors`, Number(g.away_errors) | 0, () => L.adjustErrors(g, 'away', -1), () => L.adjustErrors(g, 'away', 1))}
          {step(`${labels.home} errors`, Number(g.home_errors) | 0, () => L.adjustErrors(g, 'home', -1), () => L.adjustErrors(g, 'home', 1))}
        </div>
      </details>
      <div className="pgrid three">
        {(['first', 'second', 'third'] as const).map((k) => (
          <button key={k} type="button" className={`pdest${b[k] ? ' on' : ''}`} aria-pressed={b[k]} onClick={() => onFix(L.toggleBase(g, k))}>
            {k === 'first' ? '1st' : k === 'second' ? '2nd' : '3rd'}
          </button>
        ))}
      </div>
      <div className="pgrid three">
        <button type="button" className="btn btn-quiet" onClick={() => onFix(L.onToggleHalf(g))}>Switch half</button>
        <button type="button" className="btn btn-quiet" onClick={() => onFix(L.onPrevBatter(g))}>Prev batter</button>
        <button type="button" className="btn btn-quiet" onClick={() => onFix(L.onNextBatter(g))}>Next batter</button>
      </div>
      <button type="button" className={`btn ${final ? 'btn-quiet' : 'btn-danger'} btn-big`} onClick={() => onEnd(!final)} disabled={ending} aria-busy={ending}>
        {final ? 'Reopen the game' : ending ? 'Checking the scoring…' : 'End game'}
      </button>
      <details className="fold">
        <summary>Practice and start over</summary>
        <div className="stack" style={{ gap: 10 }}>
          {practice}
          <button type="button" className="btn btn-ghost" onClick={onStartOver}>Start the game over</button>
        </div>
      </details>
    </Sheet>
  );
}

// Who is at the plate, and each batter's number and name. A tap on a batter
// puts them up (the order goes on from them); Edit fixes a wrong number or a
// misspelt name. Our own player gets a first and last name, saved to the
// roster; a batter typed in at the field has one name, saved to this game.
export type BatterFix = { num: string; first?: string; last?: string; name?: string };
// A sub nobody had in the lineup: typed at the field, and (ours) put on the roster.
export type NewKid = { num: string; first: string; last: string; roster: boolean };
export function AtBat({ g, side, labels, rosterOf, benchOf, canRosterOf, lineupHref, locked, onPick, onSave, onSub, onClose }: {
  g: G; side: EngineSide; labels: Record<EngineSide, string>;
  rosterOf: (side: EngineSide, bid: string) => { first: string; last: string } | null;
  // Who can come in for a side: our bench, or null for theirs (typed in).
  benchOf: (side: EngineSide) => LineupBatter[] | null;
  canRosterOf: (side: EngineSide) => boolean;
  lineupHref: (side: EngineSide) => string; locked: boolean;
  onPick: (i: number) => void;
  onSave: (side: EngineSide, bid: string, fix: BatterFix) => Promise<string | null>;
  onSub: (side: EngineSide, i: number, kid: LineupBatter | NewKid) => Promise<string | null>;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<EngineSide>(side);
  const [edit, setEdit] = useState<{ bid: string; num: string; first: string; last: string; name: string; roster: boolean } | null>(null);
  const [subAt, setSubAt] = useState<number | null>(null);
  const [kid, setKid] = useState<NewKid>({ num: '', first: '', last: '', roster: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const bench = benchOf(shown);
  const canRoster = canRosterOf(shown);
  const openSub = (i: number) => { setEdit(null); setErr(''); setKid({ num: '', first: '', last: '', roster: canRoster }); setSubAt(i); };
  const sub = async (k: LineupBatter | NewKid) => {
    if (subAt === null) return;
    setBusy(true); setErr('');
    const e = await onSub(shown, subAt, k);
    setBusy(false);
    if (e) setErr(e); else setSubAt(null);
  };
  const lineup = g.lineups[shown];
  const batters = lineup?.batters ?? [];
  const at = L.currentBatterIdx(g, side);
  const open = (b: LineupBatter) => {
    const r = rosterOf(shown, b.bid);
    setErr(''); setSubAt(null);
    setEdit({ bid: b.bid, num: b.num ?? '', first: r?.first ?? '', last: r?.last ?? '', name: b.name ?? '', roster: !!r });
  };
  const save = async () => {
    if (!edit) return;
    setBusy(true); setErr('');
    const e = await onSave(shown, edit.bid, edit.roster ? { num: edit.num, first: edit.first, last: edit.last } : { num: edit.num, name: edit.name });
    setBusy(false);
    if (e) setErr(e); else setEdit(null);
  };
  const set = (k: 'num' | 'first' | 'last' | 'name') => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEdit((x) => (x ? { ...x, [k]: k === 'num' ? e.target.value.replace(/\D/g, '').slice(0, 3) : e.target.value } : x));
  return (
    <Sheet title="At the plate" onClose={onClose} close="Done">
      <div className="pgrid two" role="tablist">
        {(['away', 'home'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={shown === s} className={`pchoice${shown === s ? ' on' : ''}`} onClick={() => { setShown(s); setEdit(null); setSubAt(null); }}>
            <b>{labels[s]}</b><small>{s === side ? 'Batting' : 'In the field'}</small>
          </button>
        ))}
      </div>
      <p className="eyebrow">{shown === side ? 'Tap a batter to put them at the plate. Sub brings someone in.' : 'Sub someone in, or fix a number or a name'}</p>
      {!batters.length && <p className="note note-plain">No lineup yet for {labels[shown]}.</p>}
      <div className="atbat-list">
        {batters.map((b, i) => {
          const filled = !!(b.num || b.name);
          const up = shown === side && i === at;
          if (edit?.bid === b.bid) return (
            <div key={b.bid} className="atbat-edit">
              <div className={`field-row ${edit.roster ? 'num-first' : 'atbat-two'}`}>
                <label className="field"><span>No.</span>
                  <input className="input" inputMode="numeric" value={edit.num} onChange={set('num')} autoFocus /></label>
                {edit.roster ? <>
                  <label className="field"><span>First</span><input className="input" value={edit.first} maxLength={40} onChange={set('first')} /></label>
                  <label className="field"><span>Last</span><input className="input" value={edit.last} maxLength={40} onChange={set('last')} /></label>
                </> : <label className="field"><span>Name</span><input className="input" value={edit.name} maxLength={60} onChange={set('name')} /></label>}
              </div>
              {edit.roster && <small className="atbat-hint">Saved to the roster, so the next game has it too.</small>}
              {err && <p className="note note-bad">{err}</p>}
              <div className="pgrid two">
                <button type="button" className="btn btn-quiet" onClick={() => setEdit(null)} disabled={busy}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={save} disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          );
          if (subAt === i) {
            const ours = !!bench;
            const typed = !!(kid.num || kid.first || kid.last);
            return (
              <div key={b.bid} className="atbat-edit">
                <span className="eyebrow">In for {b.name || `No. ${b.num}`}: bats {i + 1}{positionOf(lineup, i) ? `, plays ${positionOf(lineup, i)}` : ''}</span>
                {bench && bench.length > 0 && (
                  <div className="chips">
                    {bench.map((p) => (
                      <button key={p.bid} type="button" className="chip" disabled={busy} onClick={() => sub(p)}>{p.num && `#${p.num} `}{p.name}</button>
                    ))}
                  </div>
                )}
                <div className={`field-row ${ours ? 'num-first' : 'atbat-two'}`}>
                  <label className="field"><span>No.</span>
                    <input className="input" inputMode="numeric" value={kid.num} maxLength={3}
                      onChange={(e) => setKid({ ...kid, num: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label>
                  {ours ? <>
                    <label className="field"><span>First</span><input className="input" value={kid.first} maxLength={40} onChange={(e) => setKid({ ...kid, first: e.target.value })} /></label>
                    <label className="field"><span>Last</span><input className="input" value={kid.last} maxLength={40} onChange={(e) => setKid({ ...kid, last: e.target.value })} /></label>
                  </> : <label className="field"><span>Name</span><input className="input" value={kid.first} maxLength={60} onChange={(e) => setKid({ ...kid, first: e.target.value })} /></label>}
                </div>
                {ours && canRoster && (
                  <label className="check"><input type="checkbox" checked={kid.roster} onChange={(e) => setKid({ ...kid, roster: e.target.checked })} />
                    <span>Add to the roster, so their stats count</span></label>
                )}
                {err && <p className="note note-bad">{err}</p>}
                <div className="pgrid two">
                  <button type="button" className="btn btn-quiet" onClick={() => setSubAt(null)} disabled={busy}>Cancel</button>
                  <button type="button" className="btn btn-primary" onClick={() => sub(kid)} disabled={busy || !typed} aria-busy={busy}>{busy ? 'Saving…' : 'Sub in'}</button>
                </div>
              </div>
            );
          }
          return (
            <div key={b.bid} className={`atbat-row${up ? ' on' : ''}`}>
              <button type="button" className="atbat-pick" disabled={locked || shown !== side || up || !filled} onClick={() => onPick(i)}>
                <span className="atbat-slot">{i + 1}</span>
                <span className="atbat-num">{b.num ? `#${b.num}` : '–'}</span>
                <span className="atbat-name">{b.name || (b.num ? `No. ${b.num}` : 'Empty slot')}<small>{positionOf(lineup, i) || ''}</small></span>
                {up && <span className="tag live">Up now</span>}
              </button>
              {filled && !locked && <button type="button" className="link atbat-fix" onClick={() => openSub(i)}>Sub</button>}
              {filled && <button type="button" className="link atbat-fix" onClick={() => open(b)}>Edit</button>}
            </div>
          );
        })}
      </div>
      <Link href={lineupHref(shown)} className="link" style={{ alignSelf: 'center' }}>Order, subs and positions: lineup ›</Link>
    </Sheet>
  );
}
