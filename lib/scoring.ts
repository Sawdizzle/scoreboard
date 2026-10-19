// What a play means for people. Scoreboard's rules (lib/rules/logic.js) decide
// what a tap does to the game: the count, the outs, the bases, the score. This
// file decides who it happened to, and what it adds to their line:
//
//   - the batter: a plate appearance, an at-bat, a hit, a walk, RBI ...
//   - the pitcher: a pitch, a batter faced, an out, a hit or walk allowed ...
//   - the runners: a run scored, a steal, caught stealing.
//
// The rules keep bases as true/false, so they cannot say who scored. This
// keeps a second map beside them, game.state.runners = { first: bid, ... },
// moved by the same play, and checked against the rules' own bases after
// every play: wherever the two disagree (a correction on the Situation
// screen, say), the rules win and the runner there becomes unknown. An
// unknown runner who scores still counts as a run for the pitcher; it just
// is not credited to anyone's R.
//
// Earned runs follow the errors the scorer records (see moveRunners).
import * as L from './rules/logic.js';
import type { Game, Lineup, Side } from './types.ts';

export type Bases = { first: boolean; second: boolean; third: boolean };
export type Runners = { first: string | null; second: string | null; third: string | null };
export type EngineSide = 'home' | 'away';
// The game as the rules see it: the live fields plus both lineups by
// home and away. Loose on purpose; the rules read what they need.
export type G = Record<string, unknown> & {
  inning: number; half: 'top' | 'bottom'; balls: number; strikes: number; outs: number; bases: Bases;
  home_score: number; away_score: number; state: Record<string, unknown>;
  lineups: Record<EngineSide, Lineup>;
};
export type Res = { type: string; patch: Record<string, unknown>; payload?: Record<string, unknown>; text?: string; sheet?: string };
export type StatRow = { side: Side; bid: string } & Partial<Record<StatKey, number>>;
export type StatKey =
  | 'b_pa' | 'b_ab' | 'b_h' | 'b_2b' | 'b_3b' | 'b_hr' | 'b_rbi' | 'b_r' | 'b_bb' | 'b_so' | 'b_kl' | 'b_hbp'
  | 'b_sac' | 'b_sf' | 'b_roe' | 'b_fc' | 'b_sb' | 'b_cs' | 'b_pik'
  | 'p_outs' | 'p_bf' | 'p_pitches' | 'p_h' | 'p_r' | 'p_er' | 'p_bb' | 'p_so' | 'p_hbp' | 'p_wp' | 'p_bk' | 'p_pik'
  | 'f_po' | 'f_a' | 'f_e' | 'c_sb' | 'c_cs' | 'c_pik' | 'c_pb';

export const START_LIVE = {
  inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, bases: { first: false, second: false, third: false },
  home_score: 0, away_score: 0, home_hits: 0, away_hits: 0, home_errors: 0, away_errors: 0, line_score: [], state: {},
};

// Which of our sides (us/them) is home or away in this game, and back.
export const engineSideOf = (game: Pick<Game, 'is_home'>, side: Side): EngineSide =>
  (side === 'us') === game.is_home ? 'home' : 'away';
export const sideOf = (game: Pick<Game, 'is_home'>, e: EngineSide): Side =>
  (e === 'home') === game.is_home ? 'us' : 'them';

export function engineGame(game: Pick<Game, 'is_home' | 'live' | 'status'>, lineups: Partial<Record<Side, Lineup>>, regulationInnings = 0): G {
  const us = lineups.us ?? { batters: [], positions: {} };
  const them = lineups.them ?? { batters: [], positions: {} };
  return {
    ...START_LIVE, ...(game.live as object), status: game.status, regulation_innings: regulationInnings,
    lineups: game.is_home ? { home: us, away: them } : { home: them, away: us },
  } as G;
}

const EMPTY: Runners = { first: null, second: null, third: null };
const BASES = ['first', 'second', 'third'] as const;
export const runnersOf = (g: G): Runners => ({ ...EMPTY, ...((g.state?.runners as Runners | undefined) ?? {}) });
const bases = (g: G): Bases => L.safeBases(g.bases) as Bases;

// The batter at the plate and the pitcher on the mound, by id, before a play.
export function batterBid(g: G): string | null {
  const side = L.battingSide(g) as EngineSide;
  const b = g.lineups[side]?.batters?.[L.currentBatterIdx(g, side)];
  return b && (b.num || b.name) ? b.bid : null;
}
export function pitcherBid(g: G): string | null {
  const side = L.fieldingSide(g) as EngineSide;
  return g.lineups[side]?.positions?.P ?? null;
}

// Types that are corrections, not plays: they move the game but put nothing
// on anyone's line.
const NO_STATS = new Set(['adj-score', 'adj-hits', 'adj-errors', 'adj-outs', 'adj-balls', 'adj-strikes', 'base', 'clear',
  'inning', 'half', 'batter', 'batidx', 'count', 'endhalf', 'pitcher', 'pitchadj', 'run', 'end_game', 'reopen_game', 'error']);

// The scorebook kind of a play that ended a plate appearance, or null.
export function paKind(res: Res, prev: G): string | null {
  const p = (res.payload ?? {}) as { play?: { kind?: string }; inputs?: { kind?: string }; subject?: string; reached?: number };
  switch (res.type) {
    case 'walk': return 'BB';
    case 'ibb': return 'IBB';
    case 'hbp': return 'HBP';
    case 'ci': return 'CI';
    case 'strikeout': return p.play?.kind ?? 'K';
    case 'out': return 'OUT';
    case 'homerun': return 'HR';
    case 'hit': return p.reached ? `H${p.reached}` : null;
    case 'play': return p.inputs?.kind ?? p.play?.kind ?? null;
    case 'bint': return p.subject === 'runner@third' ? null : 'BI';
    case 'bout': return 'BO';
  }
  void prev;
  return null;
}

// Where everyone went, by where they started: the batter, or the runner from
// a base. Mirrors the rules for each kind of play. Two maps ride on it: who
// the runners are, and which of them would not be on base but for an error.
type Src = 'batter' | keyof Runners;
type Trace = { to: Record<keyof Runners, Src | null>; scored: Src[]; stole: Src[]; caught: Src[]; picked: Src[]; errored: Src[] };
function trace(prev: G, res: Res): Trace {
  const on = bases(prev);
  const stay = (): Trace['to'] => ({ first: on.first ? 'first' : null, second: on.second ? 'second' : null, third: on.third ? 'third' : null });
  const none = (): Trace['to'] => ({ first: null, second: null, third: null });
  let to = stay();
  const scored: Src[] = [], stole: Src[] = [], caught: Src[] = [], picked: Src[] = [], errored: Src[] = [];
  const p = (res.payload ?? {}) as { from?: keyof Runners; kind?: string; to?: number; inputs?: { dest?: Record<string, number | 'out'>; kind?: string }; reached?: number; runs?: number };

  const forced = () => {
    // Batter to first; each runner moves only if pushed.
    if (on.first && on.second && on.third) scored.push('third');
    to = { first: 'batter', second: on.first ? 'first' : on.second ? 'second' : null, third: on.first && on.second ? 'second' : on.third ? 'third' : null };
  };
  const advanceAll = (n: number, withBatter: boolean) => {
    const out = none();
    BASES.forEach((k, i) => {
      if (!on[k]) return;
      const at = i + 1 + n;
      if (at >= 4) scored.push(k); else out[BASES[at - 1]] = k;
    });
    if (withBatter) { if (n >= 4) scored.push('batter'); else out[BASES[n - 1]] = 'batter'; }
    to = out;
  };

  switch (res.type) {
    case 'walk': case 'ibb': case 'hbp': case 'ci': forced(); break;
    case 'hit': advanceAll(p.reached ?? 1, true); break;
    case 'homerun': advanceAll(4, true); break;
    case 'balk': case 'advance': advanceAll(1, false); break;
    case 'play': {
      const out = none();
      for (const [k, at] of Object.entries(p.inputs?.dest ?? {})) {
        if (at === 'out') continue;
        if (at === 4) scored.push(k as Src);
        else if (at >= 1 && at <= 3) out[BASES[at - 1]] = k as Src;
      }
      to = out;
      // The rules take back runs scored on a third out by the batter or a force.
      if ((p.runs ?? 0) === 0) scored.length = 0;
      break;
    }
    case 'runner': {
      const from = p.from;
      if (!from) break;
      to = { ...to, [from]: null };
      if (p.kind && RUNNER_ADVANCES.has(p.kind)) {
        // The base he ended on (2, 3, or 4 for home): the next one unless the play says further.
        const end = Number(p.to) || BASES.indexOf(from) + 2;
        if (end >= 4) scored.push(from); else to[BASES[end - 1]] = from;
        if (p.kind === 'SB') stole.push(from);
        if (p.kind === 'EA') errored.push(from);
      } else if (p.kind === 'CS') caught.push(from);
      else if (p.kind === 'PO') picked.push(from);
      break;
    }
    case 'bint':
      if (!paKind(res, prev)) to = { ...to, third: null };
      break;
  }
  return { to, scored, stole, caught, picked, errored };
}
// Runner plays that move him up rather than put him out.
const RUNNER_ADVANCES = new Set(['SB', 'ADV', 'WP', 'PB', 'EA', 'DI', 'OBS']);

export type Tainted = { first: boolean; second: boolean; third: boolean };
const CLEAN: Tainted = { first: false, second: false, third: false };
export const taintedOf = (g: G): Tainted => ({ ...CLEAN, ...((g.state?.unearned as Tainted | undefined) ?? {}) });
// Errors this half that should have been outs. Once outs plus these reach
// three, the inning should be over, and nothing after it is earned.
export const errOutsOf = (g: G) => Number(g.state?.errOuts) || 0;

// Where the runners went, and how many of the runs were earned. Defers to the
// rules' own bases wherever the two disagree.
//
// Earned runs, the scorebook's rule as far as the pad can know it:
//   - a batter who reached on an error or catcher's interference is unearned
//     wherever he scores from;
//   - every run on the error play itself is unearned;
//   - once outs plus errors-that-were-outs reach three, the rest of the half
//     is unearned.
// It does not know passed balls or an extra base taken on a throwing error.
export function moveRunners(prev: G, res: Res, next: G, batter: string | null) {
  const before = runnersOf(prev), taint = taintedOf(prev);
  const t = trace(prev, res);
  const kind = paKind(res, prev);
  const reachedOnError = kind === 'E' || kind === 'CI';
  const who = (s: Src) => (s === 'batter' ? batter : before[s]);
  // A runner who moved up on an error is on base because of it, like a batter who reached on one.
  const dirty = (s: Src) => (s === 'batter' ? reachedOnError : taint[s] || t.errored.includes(s));
  const ids = (list: Src[]) => list.map(who).filter((x): x is string => !!x);

  const over = next.half !== prev.half || next.inning !== prev.inning;
  const truth = bases(next);
  const r: Runners = { ...EMPTY }, u: Tainted = { ...CLEAN };
  // A new half starts with nobody on; and the rules' bases are the truth.
  if (!over) for (const k of BASES) { const s = t.to[k]; if (s && truth[k]) { r[k] = who(s); u[k] = dirty(s); } }

  const past = (prev.outs | 0) + errOutsOf(prev) >= 3;
  return {
    runners: r, unearned: u, errOuts: over ? 0 : errOutsOf(prev) + (kind === 'E' ? 1 : 0),
    scored: t.scored.map(who), stole: ids(t.stole), caught: ids(t.caught), picked: ids(t.picked),
    // null when the half is past saving or the play was the error: no run is earned.
    earned: past || kind === 'E' ? 0 : t.scored.filter((s) => !dirty(s)).length, traced: t.scored.length,
  };
}

// The rows a play adds to people's lines, and the runner map to store with it.
export function scorePlay(prev: G, res: Res, next: G, sides: (e: EngineSide) => Side) {
  const batSide = L.battingSide(prev) as EngineSide;
  const fieldSide = L.fieldingSide(prev) as EngineSide;
  const batter = batterBid(prev), pitcher = pitcherBid(prev);
  const moved = moveRunners(prev, res, next, batter);
  const rows = new Map<string, StatRow>();
  const add = (side: EngineSide, bid: string | null, k: StatKey, n = 1) => {
    if (!bid || !n) return;
    const key = `${side}:${bid}`;
    const row = rows.get(key) ?? { side: sides(side), bid };
    row[k] = (row[k] ?? 0) + n;
    rows.set(key, row);
  };
  const carry = { runners: moved.runners, unearned: moved.unearned, errOuts: moved.errOuts };
  if (NO_STATS.has(res.type)) return { rows: [], ...carry };

  const scoreKey = batSide === 'home' ? 'home_score' : 'away_score';
  const runs = Math.max(0, (Number(next[scoreKey]) || 0) - (Number(prev[scoreKey]) || 0));
  const halfOver = next.half !== prev.half || next.inning !== prev.inning;
  const outs = halfOver ? Math.max(0, 3 - (prev.outs | 0)) : Math.max(0, (next.outs | 0) - (prev.outs | 0));
  const pitchesOf = (g: G) => Number(((g.state?.pitches as Record<string, number> | undefined) ?? {})[fieldSide]) || 0;
  const pitches = Math.max(0, Math.min(1, pitchesOf(next) - pitchesOf(prev)));

  // The pitcher.
  add(fieldSide, pitcher, 'p_pitches', pitches);
  add(fieldSide, pitcher, 'p_outs', Math.min(3, outs));
  add(fieldSide, pitcher, 'p_r', Math.min(4, runs));
  // Where the trace and the rules disagree on how many scored, the rules' count stands as earned.
  add(fieldSide, pitcher, 'p_er', Math.min(4, moved.traced === runs ? moved.earned : runs));
  if (res.type === 'balk') add(fieldSide, pitcher, 'p_bk');

  // The batter, when the play ended the plate appearance.
  const kind = paKind(res, prev);
  if (kind) {
    const b = (k: StatKey, n = 1) => add(batSide, batter, k, n);
    const p = (k: StatKey) => add(fieldSide, pitcher, k);
    b('b_pa'); p('p_bf');
    const atBat = !['BB', 'IBB', 'HBP', 'CI', 'SF', 'SAC'].includes(kind);
    if (atBat) b('b_ab');
    switch (kind) {
      case 'BB': case 'IBB': b('b_bb'); p('p_bb'); break;
      case 'HBP': b('b_hbp'); p('p_hbp'); break;
      case 'K': case 'KL': case 'K3': b('b_so'); p('p_so'); if (kind === 'KL') b('b_kl'); break;
      case 'H1': b('b_h'); p('p_h'); break;
      case 'H2': b('b_h'); b('b_2b'); p('p_h'); break;
      case 'H3': b('b_h'); b('b_3b'); p('p_h'); break;
      case 'HR': b('b_h'); b('b_hr'); p('p_h'); break;
      case 'E': b('b_roe'); break;
      case 'FC': b('b_fc'); break;
      case 'SF': b('b_sf'); break;
      case 'SAC': b('b_sac'); break;
    }
    // No RBI on an error or a double play.
    if (kind !== 'E' && kind !== 'DP') b('b_rbi', Math.min(4, runs));
  }

  // The runners.
  for (const who of moved.scored) add(batSide, who, 'b_r');
  for (const who of moved.stole) add(batSide, who, 'b_sb');
  for (const who of moved.caught) add(batSide, who, 'b_cs');
  for (const who of moved.picked) add(batSide, who, 'b_pik');

  // The fielders: the putout and the assists the play's code names, an error
  // to whoever made it, and what the catcher and the pitcher keep for
  // themselves. Whoever stood at a position when the play happened gets it.
  const note = (res.payload as { play?: { kind?: string; code?: string; outs?: number } } | undefined)?.play;
  const at = (pos: string) => prev.lineups[fieldSide]?.positions?.[pos] ?? null;
  if (note?.kind) {
    const credit = fieldingCredit(note.kind, note.code ?? '', note.outs ?? 0);
    for (const pos of credit.po) add(fieldSide, at(pos), 'f_po');
    for (const pos of credit.a) add(fieldSide, at(pos), 'f_a');
    for (const pos of credit.e) add(fieldSide, at(pos), 'f_e');
  }
  const rk = res.type === 'runner' ? (res.payload as { kind?: string } | undefined)?.kind : null;
  if (rk === 'PO') {
    add(fieldSide, pitcher, 'p_pik');
    if (fieldersOf(note?.code ?? '')[0] === 'C') add(fieldSide, at('C'), 'c_pik');
  }
  if (rk === 'CS') add(fieldSide, at('C'), 'c_cs');
  if (rk === 'SB') add(fieldSide, at('C'), 'c_sb');
  if (rk === 'PB') add(fieldSide, at('C'), 'c_pb');
  if (rk === 'WP') add(fieldSide, pitcher, 'p_wp');
  // A dropped third strike the batter beat out: the wild pitch or passed ball that let him.
  const k3 = (res.payload as { inputs?: { k3?: string; dest?: Record<string, unknown> } } | undefined)?.inputs;
  if (kind === 'K3' && k3?.dest?.batter !== 'out') {
    if (k3?.k3 === 'WP') add(fieldSide, pitcher, 'p_wp');
    if (k3?.k3 === 'PB') add(fieldSide, at('C'), 'c_pb');
  }

  return { rows: [...rows.values()], ...carry };
}

// ---- Fielding ---------------------------------------------------------------
// The scorebook code names the fielders in the order the ball went: "6-4-3",
// "2-5", "F8", "E6", "3U". Each digit is a position (1 the pitcher ... 9 right
// field).
const NUM_POS = ['', 'P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
export const fieldersOf = (code: string) => (code.match(/[1-9]/g) ?? []).map((d) => NUM_POS[Number(d)]);
const uniq = (a: string[]) => [...new Set(a)];

// Who gets what on a play, by position. The scorebook's rules, as far as a
// code can carry them:
//   - a putout for each out, to the fielders at the end of the sequence (the
//     last one, and on a double play the last two: 6-4-3 is putouts to the
//     second baseman and the first baseman);
//   - one assist to every fielder who threw before the last, once each;
//   - on an error, the error to the last fielder named and assists to any
//     before him (6 E3: the shortstop's throw dropped at first);
//   - a strikeout, and batter's interference, are the catcher's putout; a
//     dropped third strike thrown out at first is 2-3 unless the code says.
export function fieldingCredit(kind: string, code: string, outs: number) {
  const none = { po: [] as string[], a: [] as string[], e: [] as string[] };
  if (kind === 'K' || kind === 'KL' || kind === 'BI') return outs ? { ...none, po: ['C'] } : none;
  let seq = fieldersOf(code);
  if (kind === 'E' || kind === 'EA') return seq.length ? { po: [], a: uniq(seq.slice(0, -1)), e: [seq[seq.length - 1]] } : none;
  if (kind === 'K3' && outs && !seq.length) seq = ['C', '1B'];
  if (!outs || !seq.length) return none;
  const po = Array.from({ length: outs }, (_, i) => seq[Math.max(0, seq.length - outs + i)]);
  return { po, a: uniq(seq.slice(0, -1)), e: [] };
}

// Run a tap through the rules and the stats together: the patch to store
// (with the runner map folded into its state) and the rows to add.
export function record(prev: G, res: Res | null, sides: (e: EngineSide) => Side) {
  if (!res || !res.patch || !Object.keys(res.patch).length) return null;
  const stamped = L.stamp(res, prev) as Res;
  const next = { ...prev, ...stamped.patch } as G;
  const { rows, runners, unearned, errOuts } = scorePlay(prev, stamped, next, sides);
  // Who was pitching for each side when this was written, so a pitching
  // change made on the lineup screen can be noticed on the pad (pitcherChange).
  const pitcherBid = { home: next.lineups.home?.positions?.P ?? null, away: next.lineups.away?.positions?.P ?? null };
  // And who is up next for each side, by id, so a lineup edited mid-game
  // (a sub, a drop, a reorder) keeps the same kid at the plate (orderChange).
  const batBid = { home: slotBid(next, 'home'), away: slotBid(next, 'away') };
  const state = { ...((next.state as object) ?? {}), runners, unearned, errOuts, pitcherBid, batBid };
  const patch = { ...stamped.patch, state };
  return { res: stamped, patch, rows, next: { ...next, state } as G };
}

// The one-line "Last" text for the pad.
const COUNT_TYPES: Record<string, string> = { ball: 'Ball', strike: 'Strike', foul: 'Foul' };
export function lastPlayText(res: Res, prev: G, next: G) {
  if (COUNT_TYPES[res.type]) return `${COUNT_TYPES[res.type]} · ${next.balls | 0}-${next.strikes | 0}`;
  const pl = (res.payload as { play?: { kind: string; code?: string } } | undefined)?.play;
  let t = res.text || (pl && (L.PLAY_LABEL as Record<string, string>)[pl.kind]
    ? (L.PLAY_LABEL as Record<string, string>)[pl.kind] + (pl.code && pl.kind !== 'K3' ? ` ${pl.code}` : '') : '');
  if (!t) t = ({ walk: 'Walk', run: 'Run scored', base: 'Runner moved', advance: 'Runners advanced', clear: 'Bases cleared',
    endhalf: 'Half-inning ended', batter: 'Next batter', end_game: 'Game ended', reopen_game: 'Game reopened' } as Record<string, string>)[res.type] ?? '';
  if (!t && res.type.startsWith('adj')) t = 'Corrected';
  const scoreKey = L.battingSide(prev) === 'home' ? 'home_score' : 'away_score';
  const runs = Math.max(0, (Number(next[scoreKey]) || 0) - (Number(prev[scoreKey]) || 0));
  if (runs && !/run/i.test(t)) t += ` · ${runs} run${runs > 1 ? 's' : ''}`;
  if (next.half !== prev.half) t += ' · side retired';
  return t;
}

// A pitcher changed on the lineup screen since the last play: the rules move
// the pitch count over (the new pitcher starts from his own count). One side
// at a time; null when nothing changed or the game has not started.
export function pitcherChange(g: G): Res | null {
  const seen = (g.state?.pitcherBid as Record<EngineSide, string | null> | undefined);
  if (!seen) return null;
  for (const side of ['home', 'away'] as const) {
    const now = g.lineups[side]?.positions?.P ?? null;
    if (now !== (seen[side] ?? null)) {
      const r = L.onPitcherChange(g, side, seen[side] ?? null, now) as Res | null;
      return r ?? { type: 'pitcher', patch: { state: { ...g.state } }, payload: { inputs: { side, from: seen[side] ?? null, to: now } } };
    }
  }
  return null;
}

// The id in a side's batting slot right now, or null.
function slotBid(g: G, side: EngineSide): string | null {
  return g.lineups[side]?.batters?.[L.currentBatterIdx(g, side)]?.bid ?? null;
}

// The batting order is a slot pointer (state.batIdx), so an order edited on the
// lineup screen since the last play can put a different kid at the plate: a
// player dropped above him moves everyone up one, a reorder moves him. This
// finds who was up (state.batBid) and points the order back at him. If he left
// the order, whoever now has his slot (his sub, or the next batter) is up, and
// a slot past the end of a shorter order wraps to the top. One side at a time;
// null when nothing needs to move.
export function orderChange(g: G): Res | null {
  const seen = g.state?.batBid as Record<EngineSide, string | null> | undefined;
  if (!seen) return null;
  for (const side of ['home', 'away'] as const) {
    const batters = g.lineups[side]?.batters ?? [];
    if (!batters.length) continue;
    const at = L.currentBatterIdx(g, side);
    const want = seen[side] ?? null;
    if (want && batters[at]?.bid === want) continue;
    const found = want ? batters.findIndex((b) => b.bid === want) : -1;
    const i = found >= 0 ? found : at < batters.length ? at : 0;
    if (i === at) continue;
    const batIdx = { ...((g.state?.batIdx as object) ?? {}), [side]: i };
    return { type: 'batidx', text: 'Batting order updated', patch: { state: { ...g.state, batIdx } }, payload: { side, i } };
  }
  return null;
}

// Whether the game looks over as it stands, so the pad can offer End game at
// the moment it is, instead of leaving it to be found. It never ends anything:
// a tie, a time limit or a tournament's own rule is the scorer's call.
//   last     the home team leads in the bottom of the last inning or later
//            (the top just ended with them ahead, or a walk-off).
//   after    a full extra inning ended with someone ahead.
//   runrule  the margin reached the game's run rule: at once for a home lead
//            in the bottom half, at the end of an inning for an away lead.
//            Not before half the game is played, so a big first inning does
//            not nag.
export type Over = { why: 'last' | 'after' | 'runrule'; leader: EngineSide; key: string };
export function gameOver(g: G, runRule = 0): Over | null {
  const reg = Number(g.regulation_innings) | 0;
  const inn = g.inning | 0, h = g.home_score | 0, a = g.away_score | 0;
  const b = L.safeBases(g.bases) as Bases;
  const fresh = !(g.outs | 0) && !(g.balls | 0) && !(g.strikes | 0) && !b.first && !b.second && !b.third;
  const key = `${inn}${g.half}`;
  if (g.half === 'bottom' && reg && inn >= reg && h > a) return { why: 'last', leader: 'home', key };
  if (g.half === 'top' && fresh && reg && inn - 1 >= reg && h !== a) return { why: 'after', leader: h > a ? 'home' : 'away', key };
  const rr = runRule | 0;
  const floor = Math.ceil((reg || 6) / 2);
  if (rr > 0 && Math.abs(h - a) >= rr) {
    if (g.half === 'bottom' && h > a && inn >= floor) return { why: 'runrule', leader: 'home', key };
    if (g.half === 'top' && fresh && inn - 1 >= floor) return { why: 'runrule', leader: h > a ? 'home' : 'away', key };
  }
  return null;
}

// "1-3, 2B, BB": a hitter's game so far, the way GameChanger writes it.
export function tonight(line: Partial<Record<StatKey, number>> | undefined) {
  if (!line || !line.b_pa) return '';
  const parts = [`${line.b_h ?? 0}-${line.b_ab ?? 0}`];
  const n = (k: StatKey, label: string) => { const v = line[k] ?? 0; if (v) parts.push(v > 1 ? `${v} ${label}` : label); };
  n('b_hr', 'HR'); n('b_3b', '3B'); n('b_2b', '2B'); n('b_rbi', 'RBI'); n('b_bb', 'BB'); n('b_hbp', 'HBP'); n('b_so', 'K'); n('b_sb', 'SB');
  return parts.join(', ');
}

// The rules' onPlay, typed: a fielder may be named or not.
export const onPlay = L.onPlay as unknown as (g: G, p: { kind: string; pos: string | null; dest: Record<string, number | 'out'>; seq?: string[] | null; bb?: string | null; k3?: string | null }) => Res | null;
