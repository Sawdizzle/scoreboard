'use client';

import Link from 'next/link';
import { useState } from 'react';
import * as L from '@/lib/rules/logic.js';
import { positionOf } from '@/lib/rules/roster.js';
import type { EngineSide, G } from '@/lib/scoring';
import type { LineupBatter } from '@/lib/types';

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

// Strike three.
export function StrikeThree({ g, onPick, onClose }: { g: G; onPick: (k: 'swing' | 'look' | 'dropped') => void; onClose: () => void }) {
  return (
    <Sheet title="Strike three" onClose={onClose}>
      <div className="pgrid two">
        <Choice label="Swinging" onClick={() => onPick('swing')} tone="strike" />
        <Choice label="Looking" onClick={() => onPick('look')} tone="strike" />
      </div>
      <Choice label="Dropped 3rd strike" sub="Batter runs to first" onClick={() => onPick('dropped')} why={L.playBlocked(g, 'K3')} />
    </Sheet>
  );
}

const KINDS: { group: string; items: [string, string][] }[] = [
  { group: 'Hit', items: [['H1', '1B'], ['H2', '2B'], ['H3', '3B'], ['HR', 'HR']] },
  { group: 'Out', items: [['GB', 'Ground out'], ['FB', 'Fly out'], ['LD', 'Line out'], ['PU', 'Pop up']] },
  { group: 'Other', items: [['E', 'Error'], ['FC', "Fielder's choice"], ['DP', 'Double play'], ['SF', 'Sac fly'], ['SAC', 'Sac bunt']] },
];
const NEEDS_FIELDER = new Set(['GB', 'FB', 'LD', 'PU', 'E', 'FC', 'DP', 'SF', 'SAC']);
const FIELDERS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
const DEST_LABEL: [number | 'out', string][] = [['out', 'Out'], [1, '1st'], [2, '2nd'], [3, '3rd'], [4, 'Home']];
// A runner can stay, move up, score or be out; never go back.
const START: Record<string, number> = { batter: 0, first: 1, second: 2, third: 3 };
const WHO: Record<string, string> = { batter: 'Batter', first: 'From 1st', second: 'From 2nd', third: 'From 3rd' };

// Ball in play: what happened, who fielded it, where everyone ended up. The
// runner step is skipped when nobody is on, and a home run is one tap.
export function InPlay({ g, start, onRecord, onClose }: {
  g: G; start?: { kind: string; pos: string }; onRecord: (p: { kind: string; pos: string | null; dest: Record<string, number | 'out'> }) => void; onClose: () => void;
}) {
  const [kind, setKind] = useState<string | null>(start?.kind ?? null);
  const [pos, setPos] = useState<string | null>(start?.pos ?? null);
  const [dest, setDest] = useState<Record<string, number | 'out'>>(() => (start ? L.playDefaults(g, start.kind) as unknown as Record<string, number | 'out'> : {}));
  const b = L.safeBases(g.bases);
  const anyone = b.first || b.second || b.third;
  const step = !kind ? 'kind' : NEEDS_FIELDER.has(kind) && !pos ? 'fielder' : 'runners';

  function chooseKind(k: string) {
    if (k === 'HR') return onRecord({ kind: 'HR', pos: null, dest: {} });
    setKind(k);
    const d = L.playDefaults(g, k) as unknown as Record<string, number | 'out'>;
    setDest(d);
    if (!NEEDS_FIELDER.has(k) && !anyone) onRecord({ kind: k, pos: null, dest: d });
  }
  function chooseFielder(p: string) {
    setPos(p);
    if (!anyone) onRecord({ kind: kind!, pos: p, dest });
  }
  const res = kind ? L.resolvePlay(g, dest) as { outs: number; runs: number; clash: string | null } : null;

  return (
    <Sheet title={kind === 'K3' ? 'Dropped 3rd strike: where did everyone end up?' : step === 'kind' ? 'Ball in play' : step === 'fielder' ? `${(L.PLAY_LABEL as Record<string, string>)[kind!]}: who fielded it?` : 'Where did everyone end up?'} onClose={onClose}>
      {step === 'kind' && KINDS.map((grp) => (
        <div key={grp.group} className="stack" style={{ gap: 6 }}>
          <span className="legend">{grp.group}</span>
          <div className={`pgrid ${grp.items.length === 4 ? 'four' : 'three'}`}>
            {grp.items.map(([k, label]) => (
              <Choice key={k} label={label} onClick={() => chooseKind(k)} why={L.playBlocked(g, k)} tone={grp.group === 'Hit' ? 'hit' : ''} />
            ))}
          </div>
        </div>
      ))}
      {step === 'fielder' && (
        <div className="pgrid three">
          {FIELDERS.map((p) => <Choice key={p} label={p} sub={String((L.POS_NUM as Record<string, number>)[p])} onClick={() => chooseFielder(p)} />)}
        </div>
      )}
      {step === 'runners' && (
        <>
          {(['batter', 'first', 'second', 'third'] as const).filter((k) => k === 'batter' || b[k]).map((k) => (
            <div key={k} className="prunner">
              <span className="legend">{WHO[k]}</span>
              <div className="pgrid five">
                {DEST_LABEL.filter(([d]) => d === 'out' || (d as number) >= Math.max(1, START[k])).map(([d, label]) => (
                  <button key={String(d)} type="button" className={`pdest${dest[k] === d ? ' on' : ''}`} aria-pressed={dest[k] === d}
                    onClick={() => setDest({ ...dest, [k]: d })}>{label}</button>
                ))}
              </div>
            </div>
          ))}
          {res?.clash && <p className="note note-bad">Two runners end on {res.clash}. Move one of them.</p>}
          <button type="button" className="btn btn-primary btn-big" disabled={!!res?.clash}
            onClick={() => onRecord({ kind: kind!, pos, dest })}>
            Record{res ? ` · ${res.outs ? `${res.outs} out${res.outs > 1 ? 's' : ''}` : 'no outs'}${res.runs ? `, ${res.runs} run${res.runs > 1 ? 's' : ''}` : ''}` : ''}
          </button>
        </>
      )}
    </Sheet>
  );
}

export function More({ g, onPick, onClose }: { g: G; onPick: (k: 'hbp' | 'ci' | 'ibb' | 'balk') => void; onClose: () => void }) {
  const b = L.safeBases(g.bases);
  return (
    <Sheet title="More" onClose={onClose}>
      <div className="pgrid two">
        <Choice label="Hit by pitch" onClick={() => onPick('hbp')} />
        <Choice label="Intentional walk" onClick={() => onPick('ibb')} />
        <Choice label="Catcher's interference" onClick={() => onPick('ci')} />
        <Choice label="Balk" sub="Every runner moves up" onClick={() => onPick('balk')} why={b.first || b.second || b.third ? '' : 'Nobody on: a balk is a ball'} />
      </div>
    </Sheet>
  );
}

// A runner on base, tapped on the diamond.
export function Runner({ g, from, who, onPick, onClose }: {
  g: G; from: 'first' | 'second' | 'third'; who: string; onPick: (k: 'SB' | 'CS' | 'PO' | 'ADV' | 'BI') => void; onClose: () => void;
}) {
  const next = from === 'third' ? 'home' : from === 'first' ? '2nd' : '3rd';
  return (
    <Sheet title={`Runner on ${from === 'first' ? '1st' : from === 'second' ? '2nd' : '3rd'}${who ? ` · ${who}` : ''}`} onClose={onClose}>
      <div className="pgrid two">
        <Choice label={`Stole ${next}`} onClick={() => onPick('SB')} why={L.runnerBlocked(g, from, 'SB')} tone="hit" />
        <Choice label="To next base" sub="Wild pitch or passed ball" onClick={() => onPick('ADV')} why={L.runnerBlocked(g, from, 'ADV')} />
        <Choice label="Caught stealing" onClick={() => onPick('CS')} tone="strike" />
        <Choice label="Picked off" onClick={() => onPick('PO')} tone="strike" />
      </div>
      <Choice label="Batter's interference" sub="On a play on this runner" onClick={() => onPick('BI')} />
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
export function Pitching({ g, side, labels, locked, lineupHref, onPick, onClose }: {
  g: G; side: EngineSide; labels: Record<EngineSide, string>; locked: boolean;
  lineupHref: (side: EngineSide) => string;
  onPick: (side: EngineSide, pick: { bid: string } | { num: string }) => Promise<string | null>;
  onClose: () => void;
}) {
  const [shown, setShown] = useState<EngineSide>(side);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [num, setNum] = useState('');
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
    <Sheet title="Pitching change" onClose={onClose} close="Done">
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
