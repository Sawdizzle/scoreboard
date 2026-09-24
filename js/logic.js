// Pure baseball rules. Each action takes the current game row and returns
// { type, patch, payload?, sheet? }. `patch` = fields to merge (sent to the
// apply_event RPC, which snapshots prev_state for undo). No side effects here.

import { filled, FIELD_POSITIONS, slotOfBid, normalizeTeam, newBid } from './roster.js';
// The roster layer (players, ids, positions) lives in roster.js; everything
// that imports logic.js keeps reaching it here.
export * from './roster.js';

export function safeBases(b) {
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  return { first: !!(b && b.first), second: !!(b && b.second), third: !!(b && b.third) };
}

function lineScore(g) {
  const ls = Array.isArray(g.line_score) ? g.line_score.map((c) => ({ ...c })) : [];
  while (ls.length < g.inning) ls.push({ top: 0, bottom: 0 });
  return ls;
}

// Patch that adds n runs to the batting team + this half's line-score cell.
export function runsPatch(g, n) {
  if (!n) return {};
  const home = g.half === 'bottom';
  const ls = lineScore(g);
  const cell = ls[g.inning - 1];
  cell[g.half] = (cell[g.half] || 0) + n;
  return home
    ? { home_score: (g.home_score | 0) + n, line_score: ls }
    : { away_score: (g.away_score | 0) + n, line_score: ls };
}

// Standard force-advance walk. Returns resulting bases + runs forced in.
export function computeWalk(bases) {
  let { first, second, third } = safeBases(bases);
  let runs = 0;
  if (first) {
    if (second) {
      if (third) runs += 1; // bases loaded: run forced home
      third = true;         // 2nd -> 3rd
    }
    second = true;          // 1st -> 2nd
  }
  first = true;             // batter -> 1st
  return { bases: { first, second, third }, runs };
}

// Home run: the batter and every runner on base scores, the bases clear, and the
// at-bat ends (count reset). Returns the auto-computed run count for the sheet.
export function computeHomeRun(bases) {
  const b = safeBases(bases);
  const runs = (b.first ? 1 : 0) + (b.second ? 1 : 0) + (b.third ? 1 : 0) + 1;
  return { runs };
}
export function homeRunPatch(g, runs) {
  const hk = battingSide(g) === 'home' ? 'home_hits' : 'away_hits';
  return endPA(g, {
    balls: 0, strikes: 0,
    bases: { first: false, second: false, third: false },
    [hk]: (g[hk] | 0) + 1,
    ...runsPatch(g, runs),
  });
}

// Direct inning/half correction (no count/out/base reset — this is a fix-it tool,
// not the normal End-½ flow). Nudging the inning extends the line score to match.
export function onNudgeInning(g, d) {
  const inning = Math.max(1, (g.inning | 0) + d);
  return { type: 'inning', patch: { inning, line_score: lineScore({ ...g, inning }) }, payload: { inputs: { d } } };
}
export function onToggleHalf(g) {
  return { type: 'half', patch: { half: g.half === 'top' ? 'bottom' : 'top' } };
}

// Roll to the next half-inning: clear count/outs/bases, flip half, bump inning.
export function endHalfPatch(g) {
  const toBottom = g.half === 'top';
  const inning = toBottom ? g.inning : (g.inning | 0) + 1;
  const ls = lineScore({ ...g, inning });
  return {
    half: toBottom ? 'bottom' : 'top',
    inning,
    outs: 0, balls: 0, strikes: 0,
    bases: { first: false, second: false, third: false },
    line_score: ls,
  };
}

// An out (from strikeout or the OUT button); rolls the half on the 3rd.
function outResult(g, type) {
  const outs = (g.outs | 0) + 1;
  if (outs >= 3) return { type, patch: endHalfPatch(g), payload: { rolled: true } };
  return { type, patch: { outs, balls: 0, strikes: 0 } };
}

export function onBall(g) {
  const balls = (g.balls | 0) + 1;
  if (balls >= 4) {
    const w = computeWalk(g.bases);
    // The 4th ball is a pitch, but the walk is confirmed on the sheet (which
    // rebuilds the patch); the pitch is added there via withPitch, not here.
    const patch = { balls: 0, strikes: 0, bases: w.bases, ...runsPatch(g, w.runs) };
    return { type: 'walk', patch, sheet: 'walk', payload: { runs: w.runs } };
  }
  return { type: 'ball', patch: withPitch(g, { balls }) };
}

// `looking`: called third strike. Same out, its own note (a backwards K in the
// book and on the recap) and its own stinger.
export function onStrike(g, { looking = false } = {}) {
  const inputs = { looking };
  const strikes = (g.strikes | 0) + 1;
  // 3rd strike ends the at-bat (pitch + advance batter); earlier strikes just count the pitch.
  if (strikes >= 3) {
    const res = outResult(g, 'strikeout');
    const side = battingSide(g);
    return { ...res, patch: withK(g, endPA(g, res.patch)), payload: { ...(res.payload || {}), inputs, play: playNote(g, looking ? 'KL' : 'K', { outs: 1 }) },
      anim: looking ? 'strikeoutlooking' : 'strikeout', animMeta: { side, idx: currentBatterIdx(g, side) } };
  }
  return { type: 'strike', patch: withPitch(g, { strikes }), payload: { inputs } };
}

export function onFoul(g) {
  // A foul is always a pitch, even when it doesn't change the count (2 strikes).
  const patch = (g.strikes | 0) >= 2 ? {} : { strikes: (g.strikes | 0) + 1 };
  return { type: 'foul', patch: withPitch(g, patch) };
}

// A ball-in-play out (the OUT button) ends the at-bat: pitch + advance batter.
// Strikeouts go through onStrike, so this path is only in-play outs.
export function onOut(g) {
  const res = outResult(g, 'out');
  return { ...res, patch: endPA(g, res.patch), payload: { ...(res.payload || {}), play: playNote(g, 'OUT', { outs: 1 }) } };
}

// Hit by pitch: the batter takes first and forced runners move up, like a walk,
// but it is its own line in the play-by-play. The pitch counts.
export function onHitByPitch(g) {
  const w = computeWalk(g.bases);
  return { type: 'hbp', patch: endPA(g, { balls: 0, strikes: 0, bases: w.bases, ...runsPatch(g, w.runs) }),
    payload: { runs: w.runs, play: playNote(g, 'HBP', { runs: w.runs }) }, ...reachAnim(g, 'Hit by pitch', w.runs) };
}

// Catcher's interference: the batter is awarded first and forced runners move
// up, like a hit by pitch. The pitch counts. Its own line in the play-by-play.
export function onCatcherInterference(g) {
  const w = computeWalk(g.bases);
  return { type: 'ci', patch: endPA(g, { balls: 0, strikes: 0, bases: w.bases, ...runsPatch(g, w.runs) }),
    payload: { runs: w.runs, play: playNote(g, 'CI', { runs: w.runs }) }, ...reachAnim(g, 'Catcher’s interference', w.runs) };
}

// Intentional walk: awarded without a pitch, so the pitch count stays and the
// order moves on. Forced advance only — nobody runs on an intentional walk, so
// there is no sheet to confirm. Its own slide-out, so it doesn't read as ball four.
export function onIntentionalWalk(g) {
  const w = computeWalk(g.bases);
  const patch = { balls: 0, strikes: 0, bases: w.bases, ...runsPatch(g, w.runs) };
  const bi = advanceBatterState(g);
  if (bi) patch.state = { ...(g.state || {}), batIdx: bi };
  return { type: 'ibb', patch, payload: { runs: w.runs, play: playNote(g, 'IBB', { runs: w.runs }) }, ...reachAnim(g, 'Intentional walk', w.runs) };
}

// Runner plays between pitches: a steal, caught stealing, a pickoff, or a runner
// moving up on a wild pitch / passed ball / balk. `from` is the base the runner
// started on ('first' | 'second' | 'third'). None of them end the at-bat: the
// count stays, no pitch is added, the same batter is still up. A third out
// ends the half, and the batter leads off next inning (batIdx is not moved).
export const RUNNER_LABEL = { SB: 'Stolen base', CS: 'Caught stealing', PO: 'Picked off', ADV: 'Runner advanced' };
const NEXT_BASE = { first: 'second', second: 'third', third: null };
export function runnerBlocked(g, from, kind) {
  const b = safeBases(g.bases);
  if (!b[from]) return 'Nobody on that base';
  if (kind === 'SB' || kind === 'ADV') {
    const to = NEXT_BASE[from];
    if (to && b[to]) return `${to === 'second' ? '2nd' : '3rd'} is taken — move that runner first`;
  }
  return '';
}
// Balk: every runner moves up one base and a runner on 3rd scores. No pitch,
// the count stays, the same batter is still up. Null with nobody on (with the
// bases empty a balk is a ball, and BALL is the key for that).
export function onBalk(g) {
  const b = safeBases(g.bases);
  if (!b.first && !b.second && !b.third) return null;
  const runs = b.third ? 1 : 0;
  const bases = { first: false, second: b.first, third: b.second };
  return { type: 'balk', patch: { bases, ...runsPatch(g, runs) }, payload: { runs, play: playNote(g, 'BK', { runs }) },
    anim: 'play', animMeta: { text: 'Balk', runs }, text: runs ? 'Balk · run scores' : 'Balk · runners up' };
}

// Batter's interference on a play at a base (the catcher's throw on a steal).
// The batter is out, the pitch counts, and every runner goes back to the base
// he held: nobody advances. One exception, from the rulebook: with fewer than
// 2 outs and the play on a runner trying to score from 3rd, THAT runner is out
// instead, and the batter stays up with the count as it was.
// (If the catcher throws the runner out anyway, the interference is ignored:
// record Caught stealing instead.)
export function onBatterInterference(g, from) {
  const b = safeBases(g.bases);
  if (!b[from]) return null;
  const side = battingSide(g);
  const text = 'Batter’s interference';
  if (from === 'third' && (g.outs | 0) < 2) {
    const bases = { ...b, third: false };
    const patch = withPitch(g, { outs: (g.outs | 0) + 1, bases });
    return { type: 'bint', patch, payload: { from, inputs: { from }, subject: 'runner@third', play: playNote(g, 'BI', { outs: 1 }) },
      anim: 'play', animMeta: { text: 'Runner out · batter’s interference' }, text: 'Batter’s interference · runner out at home' };
  }
  const res = outResult({ ...g, bases: b }, 'bint');
  return { ...res, patch: endPA(g, res.patch), payload: { ...(res.payload || {}), from, inputs: { from }, play: playNote(g, 'BI', { outs: 1 }) },
    anim: 'play', animMeta: { text, side, idx: currentBatterIdx(g, side) }, text: `${text} · batter out` };
}

export function onRunnerPlay(g, from, kind) {
  if (!RUNNER_LABEL[kind] || runnerBlocked(g, from, kind)) return null;
  const b = safeBases(g.bases);
  const bases = { ...b, [from]: false };
  if (kind === 'CS' || kind === 'PO') {
    const outs = (g.outs | 0) + 1;
    const patch = outs >= 3 ? endHalfPatch({ ...g, bases }) : { outs, bases };
    return { type: 'runner', patch, payload: { from, kind, play: playNote(g, kind, { outs: 1 }) },
      anim: 'play', animMeta: { text: RUNNER_LABEL[kind] }, text: RUNNER_LABEL[kind] };
  }
  const to = NEXT_BASE[from];
  const runs = to ? 0 : 1;
  if (to) bases[to] = true;
  const text = kind === 'SB' ? (to ? `Stole ${to === 'second' ? '2nd' : '3rd'}` : 'Stole home') : RUNNER_LABEL[kind];
  return { type: 'runner', patch: { bases, ...runsPatch(g, runs) }, payload: { from, kind, runs, play: playNote(g, kind, { runs }) },
    // SB has its own stinger; a runner moving up on a wild pitch or passed ball
    // slides out like any other play, and flashes the run if he scored.
    anim: kind === 'SB' ? 'stolenbase' : 'play', animMeta: kind === 'SB' ? {} : { text: runs ? 'Runner scores' : 'Runner advances', runs }, text };
}

export function onRun(g) { return { type: 'run', patch: runsPatch(g, 1) }; }

// A base hit reaching `reached` (1/2/3). Smart default: every existing runner
// advances `reached` bases; the batter takes `reached`. Runners past 3rd score.
// Records a hit for the batting team, counts the pitch, advances the order.
export function onHit(g, reached) {
  const b = safeBases(g.bases);
  const occ = [b.first, b.second, b.third];
  const keys = ['first', 'second', 'third'];
  const nb = { first: false, second: false, third: false };
  let runs = 0;
  occ.forEach((on, i) => { if (!on) return; const dest = i + reached; if (dest >= 3) runs += 1; else nb[keys[dest]] = true; });
  const bdest = reached - 1;
  if (bdest >= 3) runs += 1; else nb[keys[bdest]] = true;
  const hk = battingSide(g) === 'home' ? 'home_hits' : 'away_hits';
  const patch = endPA(g, { balls: 0, strikes: 0, bases: nb, [hk]: (g[hk] | 0) + 1, ...runsPatch(g, runs) });
  return { type: 'hit', patch, payload: { reached, runs }, anim: reached === 3 ? 'bigplay' : null };
}

// An error is charged to the fielding (defensive) team. Stat only — place the
// runner with the base buttons; does not end the at-bat or count a pitch.
export function onError(g) {
  const ek = fieldingSide(g) === 'home' ? 'home_errors' : 'away_errors';
  return { type: 'error', patch: { [ek]: (g[ek] | 0) + 1 } };
}

// The team currently at bat (top = away hits, bottom = home hits) and the team
// in the field (which is the one whose pitcher is on the mound).
export function battingSide(g) { return g.half === 'bottom' ? 'home' : 'away'; }
export function fieldingSide(g) { return battingSide(g) === 'away' ? 'home' : 'away'; }

// ---- Lineup accessors (shared by control + overlay) -----------------------
export function teamLineup(g, side) {
  const t = (g.lineups || {})[side] || {};
  return { pitcher: t.pitcher || { name: '', num: '' }, batters: Array.isArray(t.batters) ? t.batters : [] };
}
export function currentBatterIdx(g, side) {
  return (((g.state && g.state.batIdx) || {})[side] | 0);
}
// The hitter at bat for the batting team, or null if that team has no lineup.
export function currentBatter(g) {
  const side = battingSide(g);
  const { batters } = teamLineup(g, side);
  const b = batters[currentBatterIdx(g, side)];
  return filled(b) ? b : null;
}
// The pitcher on the mound = the fielding team's pitcher, or null if unset.
export function currentPitcher(g) {
  const p = teamLineup(g, fieldingSide(g)).pitcher;
  return filled(p) ? p : null;
}
// ---- Defensive positions --------------------------------------------------
// Resolve a position to its {num,name}, or null if unset.
export function fielderAt(g, side, pos) {
  const t = normalizeTeam((g.lineups || {})[side] || {});
  const b = t.batters[slotOfBid(t, t.positions[pos])];
  if (filled(b)) return b;
  // A pitcher typed in before the order existed still belongs on the mound.
  if (pos === 'P' && filled(t.pitcher)) return t.pitcher;
  return null;
}

// ---- Mid-Inning, on its own -----------------------------------------------
// The third out raises the Mid-Inning card so the stream has something up while
// the teams change and the operator fixes positions. Not when that half ended
// the game (home ahead after the top of the last inning, or a lead after a
// completed extra inning): that is the Final card's moment.
export function halfEndsGame(after) {
  const reg = after.regulation_innings | 0;
  if (!reg) return false;
  const inn = after.inning | 0, h = after.home_score | 0, a = after.away_score | 0;
  if (after.half === 'bottom') return inn >= reg && h > a;     // top of the last just ended, home leads
  return inn - 1 >= reg && h !== a;                             // a full last (or extra) inning just ended
}
// A play that belongs to the new half takes Mid-Inning down.
export const HALF_STARTERS = new Set(['ball', 'strike', 'foul', 'strikeout', 'walk', 'ibb', 'hbp', 'ci', 'hit', 'play', 'homerun', 'runner', 'balk', 'bint', 'run', 'error']);

// Ordered batting lineup for a side, each row tagged with its fielding position
// (P for the pitcher, the assigned spot, or '' for DH/unset) and whether it's the
// hitter at bat — for the lineup broadcast card.
export function battingOrderCard(g, side) {
  const t = normalizeTeam((g.lineups || {})[side] || {});
  const positions = t.positions;
  const posByIdx = {};
  for (const [pos, bid] of Object.entries(positions)) {
    const i = slotOfBid(t, bid);
    if (i >= 0) posByIdx[i] = pos;
  }
  const p = t.pitcher || {};
  const hasP = p.num || p.name;
  // Only fill "DH" once a defense actually exists; otherwise leave it blank so a
  // half-set-up lineup doesn't read as all-DH.
  const hasDefense = Object.keys(positions).length > 0 || !!hasP;
  const curIdx = currentBatterIdx(g, side);
  const out = [];
  t.batters.forEach((b, i) => {
    if (!filled(b)) return;
    // Assigned field spot; the pitcher wins P; an in-order batter not on the field
    // reads as DH (once a defense is set).
    let pos = posByIdx[i] || (hasDefense ? 'DH' : '');
    if (hasP && (b.num || '') === (p.num || '') && (b.name || '') === (p.name || '')) pos = 'P';
    out.push({ order: out.length + 1, num: b.num || '', name: b.name || '', pos, current: i === curIdx });
  });
  return out;
}

// ---- Pitch count (auto, per pitcher) --------------------------------------
// Counts live in state.pitches keyed by side; the count shown is the fielding
// team's (the pitcher on the mound). withPitch() adds one pitch to that tally
// while preserving any other state (batIdx) already in the game/patch.
export function pitchCount(g) {
  return (((g.state && g.state.pitches) || {})[fieldingSide(g)] | 0);
}
export function withPitch(g, patch) {
  const side = fieldingSide(g);
  const cur = (g.state && g.state.pitches) || {};
  const baseState = patch.state || (g.state || {});
  return { ...patch, state: { ...baseState, pitches: { ...cur, [side]: (cur[side] | 0) + 1 } } };
}
// Strikeouts by the pitcher on the mound, the way state.pitches holds his pitch
// count: state.ks[side] is the fielding side's current pitcher, and state.kLog
// keeps every pitcher's by roster id across a change (onPitcherChange). On the
// game row so an overlay reload, or an undo, has the true number. `patch` is
// the play's own patch, whose state (the batting order moving on) it keeps.
export function withK(g, patch) {
  const side = fieldingSide(g);
  const st = patch.state || g.state || {};
  const ks = st.ks || {};
  return { ...patch, state: { ...st, ks: { ...ks, [side]: (ks[side] | 0) + 1 } } };
}
export const strikeoutsFor = (g, side) => (((g.state && g.state.ks) || {})[side] | 0);

// A new pitcher starts from his own count, not the last one's. state.pitches
// stays the count of whoever is on the mound (the overlay reads it as a
// number); state.pitchLog keeps every pitcher's tally by roster id, so a
// pitcher who comes back picks up where he left off. Null when nothing moves.
export function onPitcherChange(g, side, fromBid, toBid) {
  if (fromBid === toBid) return null;
  const st = g.state || {};
  const cur = st.pitches || {};
  const log = st.pitchLog || {};
  const mine = { ...(log[side] || {}) };
  const now = cur[side] | 0;
  if (fromBid) mine[fromBid] = now;
  const next = toBid ? (mine[toBid] | 0) : 0;
  // Strikeouts travel the same way: banked for the pitcher leaving, restored for one coming back.
  const ks = st.ks || {}, kLog = st.kLog || {};
  const myK = { ...(kLog[side] || {}) };
  const kNow = ks[side] | 0;
  if (fromBid) myK[fromBid] = kNow;
  const kNext = toBid ? (myK[toBid] | 0) : 0;
  if (now === next && kNow === kNext && !(fromBid && (now || kNow))) return null;
  return {
    type: 'pitcher', text: 'New pitcher',
    patch: { state: { ...st, pitches: { ...cur, [side]: next }, pitchLog: { ...log, [side]: mine },
      ks: { ...ks, [side]: kNext }, kLog: { ...kLog, [side]: myK } } },
    payload: { inputs: { side, from: fromBid || null, to: toBid || null } },
  };
}
export function adjustPitch(g, d) {
  const side = fieldingSide(g);
  const cur = (g.state && g.state.pitches) || {};
  const next = Math.max(0, (cur[side] | 0) + d);
  return { type: 'pitchadj', patch: { state: { ...(g.state || {}), pitches: { ...cur, [side]: next } } }, payload: { inputs: { d } } };
}

// The next `n` filled hitters after the current one, wrapping (for Due Up).
export function dueUp(g, n = 3) {
  const side = battingSide(g);
  const { batters } = teamLineup(g, side);
  const total = batters.length;
  const out = [];
  let j = currentBatterIdx(g, side), seen = 0;
  while (out.length < n && seen < total) {
    j = (j + 1) % total; seen++;
    if (filled(batters[j])) out.push(batters[j]);
  }
  return out;
}

// The Due Up card: who is coming to the plate, starting with the one at bat.
// dueUp() above is "who follows" — the batter strip wants that, because the
// hitter is already on the line above it. The card is the list a broadcast
// shows between innings, and there the first name is the most important one:
// it skipped him, so a leadoff hitter never appeared on his own team's card.
// Each entry carries `current` so the card can mark who is up now.
export function dueUpCard(g, side = battingSide(g), n = 3) {
  const { batters } = teamLineup(g, side);
  const total = batters.length;
  const out = [];
  const start = currentBatterIdx(g, side);
  for (let step = 0; step < total && out.length < n; step++) {
    const j = (start + step) % total;
    if (filled(batters[j])) out.push({ ...batters[j], current: j === start });
  }
  return out;
}

// Index of the next non-empty batter after `cur`, wrapping. Returns cur if none.
function nextFilledIdx(batters, cur) {
  const n = batters.length;
  for (let step = 1; step <= n; step++) {
    const j = (cur + step) % n;
    const b = batters[j];
    if (b && (b.name || b.num)) return j;
  }
  return cur;
}

// Index of the previous non-empty batter before `cur`, wrapping. Returns cur if none.
function prevFilledIdx(batters, cur) {
  const n = batters.length;
  for (let step = 1; step <= n; step++) {
    const j = ((cur - step) % n + n) % n;
    const b = batters[j];
    if (b && (b.name || b.num)) return j;
  }
  return cur;
}

// Move the batting team's lineup index one filled slot, forward or back.
// Returns the new batIdx map, or null if that team has no lineup entered.
function stepBatterState(g, d) {
  const side = battingSide(g);
  const t = (g.lineups || {})[side] || {};
  const batters = Array.isArray(t.batters) ? t.batters : [];
  if (!batters.some((b) => b && (b.name || b.num))) return null;
  const bi = (g.state && g.state.batIdx) || {};
  const cur = bi[side] | 0;
  return { ...bi, [side]: d < 0 ? prevFilledIdx(batters, cur) : nextFilledIdx(batters, cur) };
}
const advanceBatterState = (g) => stepBatterState(g, 1);

// End a plate appearance: count the pitch for the fielding pitcher AND advance
// the batting order to the next hitter. Used by every terminal outcome
// (out, strikeout, walk, hit, home run) so one tap moves everything.
export function endPA(g, patch) {
  const bi = advanceBatterState(g);
  const withBatter = bi ? { ...patch, state: { ...(patch.state || g.state || {}), batIdx: bi } } : patch;
  return withPitch(g, withBatter);
}

// Next Batter (manual): clears the count and advances the order, no pitch.
export function onNextBatter(g) {
  const bi = advanceBatterState(g);
  const patch = { balls: 0, strikes: 0 };
  if (bi) patch.state = { ...(g.state || {}), batIdx: bi };
  return { type: 'batter', patch };
}

// Previous batter (manual): the repair for an order that got pushed on by a tap
// that should not have ended the at-bat — an out recorded on a runner, say. The
// count is left where it is, because this is a correction and not a new hitter.
export function onPrevBatter(g) {
  const bi = stepBatterState(g, -1);
  return bi ? { type: 'batter', patch: { state: { ...(g.state || {}), batIdx: bi } } } : null;
}

export function onResetCount(g) { return { type: 'count', patch: { balls: 0, strikes: 0 } }; }

export function onEndHalf(g) { return { type: 'endhalf', patch: endHalfPatch(g) }; }

// Advance all runners one base; runner on 3rd scores.
export function onAdvance(g) {
  const b = safeBases(g.bases);
  const bases = { first: false, second: b.first, third: b.second };
  const runs = b.third ? 1 : 0;
  return { type: 'advance', patch: { bases, ...runsPatch(g, runs) }, payload: { runs } };
}

export function onClearBases(g) {
  return { type: 'clear', patch: { bases: { first: false, second: false, third: false } } };
}

export function toggleBase(g, key) {
  const b = safeBases(g.bases);
  return { type: 'base', patch: { bases: { ...b, [key]: !b[key] } }, payload: { inputs: { key } } };
}

// ---- Balls in play --------------------------------------------------------
// An out, an error, a fielder's choice, a dropped third strike and a hit all
// end the same way: someone fielded it, and every runner finished somewhere.
// The pad asks for both. These turn the answer into the play.
//
// A destination is 'out', a base (1, 2, 3) or 4 for home. `dest` is keyed by
// where each person started: 'batter', 'first', 'second', 'third'.
export const POS_NUM = { P: 1, C: 2, '1B': 3, '2B': 4, '3B': 5, SS: 6, LF: 7, CF: 8, RF: 9 };
const START = { batter: 0, first: 1, second: 2, third: 3 };
const BASE_KEY = { 1: 'first', 2: 'second', 3: 'third' };
const HIT_BASES = { H1: 1, H2: 2, H3: 3 };
export const PLAY_LABEL = {
  GB: 'Groundout', FB: 'Flyout', LD: 'Lineout', PU: 'Pop-up', E: 'Reached on error',
  FC: 'Fielder’s choice', DP: 'Double play', SF: 'Sac fly', SAC: 'Sac bunt', K3: 'Dropped 3rd strike',
  H1: 'Single', H2: 'Double', H3: 'Triple',
  // Recorded for the play-by-play by their own buttons, not the ball-in-play sheet.
  K: 'Strikeout swinging', KL: 'Strikeout looking', BB: 'Walk', IBB: 'Intentional walk', HBP: 'Hit by pitch', CI: 'Catcher’s interference',
  SB: 'Stolen base', CS: 'Caught stealing', PO: 'Picked off', ADV: 'Runner advanced', BK: 'Balk', BI: 'Batter’s interference', HR: 'Home run', OUT: 'Out',
};

// The name-free note an at-bat leaves in the event payload, which apply_event
// copies into the public play-by-play. The inning and half are the ones the
// play happened in — a third out has rolled them by the time the row saves.
export function playNote(g, kind, { pos = null, code = '', outs = 0, runs = 0 } = {}) {
  return { kind, pos, code, outs, runs, inning: g.inning | 0, half: g.half };
}

// The slide-out a batter-reaching play earns: its name, with the hitter's name
// under it (the overlay looks the slot up in its roster; no name rides here).
const reachAnim = (g, text, runs) => {
  const side = battingSide(g);
  return { anim: 'play', animMeta: { text, side, idx: currentBatterIdx(g, side), runs } };
};

// A fielder tapped with no type picked: infielders make groundouts, outfielders flyouts.
export const autoKind = (pos) => ((POS_NUM[pos] || 0) >= 7 ? 'FB' : 'GB');

// The scorebook shorthand. A groundout is thrown to first unless the first
// baseman fielded it himself (3U); a double play takes the usual pivot.
const DP_PATH = { 1: '1-6-3', 2: '2-6-3', 3: '3-6-3', 4: '4-6-3', 5: '5-4-3', 6: '6-4-3' };
export function playCode(kind, pos) {
  if (kind === 'K3') return 'K';
  const n = POS_NUM[pos];
  if (!n || HIT_BASES[kind]) return '';
  switch (kind) {
    case 'GB': return n === 3 ? '3U' : `${n}-3`;
    case 'FB': return `F${n}`;
    case 'LD': return `L${n}`;
    case 'PU': return `P${n}`;
    case 'E':  return `E${n}`;
    case 'FC': return `${n}-${n === 4 ? 6 : 4}`;
    case 'DP': return DP_PATH[n] || `${n}-2`;
    case 'SF': return `SF${n}`;
    case 'SAC': return n === 3 ? '3U' : `${n}-3`;
  }
  return '';
}

// Why a play can't have happened with the game as it stands, or '' if it can.
export function playBlocked(g, kind) {
  const b = safeBases(g.bases);
  const anyone = b.first || b.second || b.third;
  const outs = g.outs | 0;
  switch (kind) {
    case 'FC': return anyone ? '' : 'A fielder’s choice needs a runner on base';
    case 'DP': return !anyone ? 'A double play needs a runner on base' : outs >= 2 ? 'A double play needs fewer than 2 outs' : '';
    case 'SF': return !b.third ? 'A sac fly needs a runner on 3rd' : outs >= 2 ? 'A sac fly needs fewer than 2 outs' : '';
    case 'SAC': return !anyone ? 'A sac bunt needs a runner on base' : outs >= 2 ? 'A sac bunt needs fewer than 2 outs' : '';
    case 'K3':
      if ((g.strikes | 0) < 2) return 'A dropped 3rd strike needs 2 strikes on the batter — Undo the strikeout first';
      return b.first && outs < 2 ? 'The batter can’t run: 1st base is taken with fewer than 2 outs' : '';
  }
  return '';
}

// Is the runner on this base forced by the batter taking first?
const forcedFrom = (b, key) => (key === 'first' ? true : key === 'second' ? b.first : b.first && b.second);

// The likely result, pre-picked so the common play is one tap on Record.
export function playDefaults(g, kind) {
  const b = safeBases(g.bases);
  const on = ['first', 'second', 'third'].filter((k) => b[k]);
  const lead = on[on.length - 1];
  const dest = {};
  const each = (fn) => on.forEach((k) => { dest[k] = fn(k, START[k]); });
  const up = (n) => (k, s) => Math.min(4, s + n);
  switch (kind) {
    case 'GB': dest.batter = 'out'; each((k, s) => (forcedFrom(b, k) ? s + 1 : s)); break;
    case 'FB': case 'LD': case 'PU': dest.batter = 'out'; each((k, s) => s); break;
    case 'SF': dest.batter = 'out'; each((k, s) => (k === 'third' ? 4 : s)); break;
    case 'SAC': dest.batter = 'out'; each(up(1)); break;
    case 'FC': { dest.batter = 1; const gone = b.first ? 'first' : lead; each((k, s) => (k === gone ? 'out' : forcedFrom(b, k) ? s + 1 : s)); break; }
    case 'DP': { dest.batter = 'out'; const gone = b.first ? 'first' : lead; each((k, s) => (k === gone ? 'out' : s)); break; }
    case 'E': case 'K3': dest.batter = 1; each(up(1)); break;
    default: { const n = HIT_BASES[kind]; if (n) { dest.batter = n; each(up(n)); } }
  }
  return dest;
}

// Where everyone finished. `clash` names a base two people ended up on — the
// play can't be recorded until one of them moves.
export function resolvePlay(g, dest) {
  let outs = 0, runs = 0, clash = null;
  const bases = { first: false, second: false, third: false };
  for (const to of Object.values(dest || {})) {
    if (to === 'out') { outs++; continue; }
    if (to === 4) { runs++; continue; }
    const key = BASE_KEY[to];
    if (!key) continue;
    if (bases[key]) clash = key;
    bases[key] = true;
  }
  return { outs, runs, bases, clash };
}

// The play itself. Returns null for a play that can't be recorded as given.
//
// Runs don't count on a play whose third out is the batter (he never reached)
// or a force (a groundout, fielder's choice or double play). A runner thrown
// out on the bases after another run crossed is a timing play, and that run
// stands — the rule a scorer applies, close enough that the rare exception is a
// Runs correction in the Situation sheet.
//
// The stinger carries the batter's lineup slot and never a name: current_animation
// is on the public row. The overlay looks the name up in the roster it holds.
export function onPlay(g, { kind, pos = null, dest }) {
  if (!PLAY_LABEL[kind]) return null;
  const r = resolvePlay(g, dest);
  if (r.clash) return null;
  const outs = (g.outs | 0) + r.outs;
  const endsHalf = outs >= 3;
  const force = kind === 'GB' || kind === 'FC' || kind === 'DP';
  const runs = endsHalf && (dest.batter === 'out' || force) ? 0 : r.runs;
  let patch = { balls: 0, strikes: 0, bases: r.bases, ...runsPatch(g, runs) };
  if (HIT_BASES[kind]) { const hk = battingSide(g) === 'home' ? 'home_hits' : 'away_hits'; patch[hk] = (g[hk] | 0) + 1; }
  if (kind === 'E') { const ek = fieldingSide(g) === 'home' ? 'home_errors' : 'away_errors'; patch[ek] = (g[ek] | 0) + 1; }
  patch = endsHalf ? { ...patch, ...endHalfPatch({ ...g, ...patch }) } : { ...patch, outs };
  const code = playCode(kind, pos);
  const text = code && kind !== 'K3' ? `${PLAY_LABEL[kind]} ${code}` : PLAY_LABEL[kind];
  const side = battingSide(g);
  return {
    type: 'play',
    patch: kind === 'K3' ? withK(g, endPA(g, patch)) : endPA(g, patch),
    payload: { inputs: { kind, pos, dest }, runs, play: playNote(g, kind, { pos, code, outs: r.outs, runs }) },
    anim: kind === 'DP' ? 'doubleplay' : kind === 'H3' ? 'bigplay' : 'play',
    animMeta: { text, side, idx: currentBatterIdx(g, side), runs },
    text,
  };
}

// ---- Who the event was about ----------------------------------------------
// Every event carries a subject. This is the first half of the move to an
// event-sourced game: today it is metadata on the log, and tomorrow it is what
// a replay reads to decide whether the batting order moves at all.
//
// The rule it encodes is the one a scorer already knows and the pad did not:
// only a terminal BATTER event ends a plate appearance. An out recorded on a
// runner — a steal, a pickoff — leaves the count, the hitter and the order
// exactly where they were. The pad learned that in v3.86 by routing the tap;
// this records it in the data, where a fold can enforce it.
//
// `stamp` is the single place it is attached, so an action added later cannot
// quietly ship without one. subjectTest in the suite walks every exported
// action and fails if any of them comes back unstamped.
export const SUBJECTS = ['batter', 'runner@first', 'runner@second', 'runner@third', 'runners', 'game'];

// Events named by the thing they happen to. Anything not here is a correction
// or a clock/inning move and belongs to the game, not to a person.
const BATTER_EVENTS = new Set(['ball', 'strike', 'foul', 'strikeout', 'out', 'walk', 'ibb', 'hbp', 'ci', 'bint', 'hit',
  'homerun', 'play', 'error', 'batter', 'batidx']);

export function subjectOf(res, g) {
  if (!res || !res.type) return 'game';
  const given = res.payload && res.payload.subject;
  if (given && SUBJECTS.includes(given)) return given;      // an action that knows better
  if (res.type === 'runner') {
    const from = res.payload && res.payload.from;
    return from ? `runner@${from}` : 'runners';
  }
  if (res.type === 'advance' || res.type === 'clearbases' || res.type === 'balk') return 'runners';
  if (BATTER_EVENTS.has(res.type)) return 'batter';
  return 'game';
}
// Attach the subject to an action's payload. Idempotent, and it never
// overwrites a subject the action set itself.
export function stamp(res, g) {
  if (!res || !res.type) return res;
  return { ...res, payload: { ...(res.payload || {}), subject: subjectOf(res, g) } };
}

// ---- The half, replayed (Mid-Inning) ---------------------------------------
// Mid-Inning sits on air for a minute or more between every half. It used to
// hold the score and the line score and nothing else; now it replays the half
// that just ended from the public play-by-play — the same name-free rows the
// recap page reads — so the break tells the viewer what happened in it.

// The half that has just finished, judged from where the game now stands. The
// third out has already rolled the row: bottom of the 3rd means the top of the
// 3rd just ended; top of the 4th means the bottom of the 3rd did.
export function finishedHalf(g) {
  const inn = g.inning | 0;
  return g.half === 'bottom' ? { inning: inn, half: 'top' } : { inning: Math.max(1, inn - 1), half: 'bottom' };
}
const HIT_KINDS = new Set(['H1', 'H2', 'H3', 'HR']);
// IBB and CI are named here ahead of their keys, so a half with one in it is
// never mistaken for three up, three down.
const ON_BASE_KINDS = new Set(['H1', 'H2', 'H3', 'HR', 'BB', 'IBB', 'HBP', 'CI', 'E', 'FC', 'K3']);
// Chip text. The strikeouts drop "swinging", because the K in front says
// strikeout and a reversed K says looking — the way the scorebook writes them.
const CHIP_LABEL = { ...PLAY_LABEL, K: 'Strikeout', KL: 'Strikeout looking' };

// The rows for one half, ready to draw: what happened, the scorebook code, the
// outs and runs on each, and a one-line summary. A half with three plays, three
// outs and nobody on is a 1-2-3 inning, and says so rather than showing nothing.
export function halfRecap(plays, g) {
  const { inning, half } = finishedHalf(g);
  const rows = (plays || []).filter((p) => (p.inning | 0) === inning && p.half === half).map((p) => ({
    kind: p.kind,
    label: CHIP_LABEL[p.kind] || p.kind,
    code: p.code && p.kind !== 'K3' && p.kind !== 'K' && p.kind !== 'KL' ? p.code : '',
    outs: p.outs | 0,
    runs: p.runs | 0,
    k: p.kind === 'K' || p.kind === 'KL',
    backwards: p.kind === 'KL',
  }));
  const runs = rows.reduce((n, r) => n + r.runs, 0);
  const hits = rows.filter((r) => HIT_KINDS.has(r.kind)).length;
  const walks = rows.filter((r) => r.kind === 'BB' || r.kind === 'IBB').length;
  const outs = rows.reduce((n, r) => n + r.outs, 0);
  const oneTwoThree = rows.length === 3 && outs === 3 && !runs && !rows.some((r) => ON_BASE_KINDS.has(r.kind));
  return { inning, half, rows, runs, hits, walks, outs, oneTwoThree };
}

// ---- The fold: a game rebuilt from its own events --------------------------
// Stage 2 of moving the game onto its log. This runs in the SHADOW: the pad
// folds the log, compares the answer to the live row and says whether the two
// agree. Nothing here writes anything, and nothing on the scorebug comes from
// it. The point is to find out whether the fold is right before anything is
// staked on it.
//
// It does not reimplement the rules. It re-runs the same actions with the
// arguments the event recorded, so the fold and the pad cannot drift apart:
// there is one set of baseball rules in this file, and both callers use it.
//
// The log is trimmed to the newest 200 events per game, so the fold does not
// start at the first pitch. It starts at the oldest snapshot it still has —
// every event stores the row as it was BEFORE it — and folds forward from
// there. That makes the check work on a 400-pitch game as well as a short one.
//
// An event whose type it cannot rebuild is counted and skipped, never guessed.
// A skip is reported, because a fold that quietly ignores a third of the game
// would agree with anything.
const REBUILD = {
  ball:      (g) => onBall(g),
  strike:    (g, p) => onStrike(g, { looking: !!(p.inputs && p.inputs.looking) }),
  foul:      (g) => onFoul(g),
  strikeout: (g, p) => onStrike(g, { looking: !!(p.inputs && p.inputs.looking) }),
  out:       (g) => onOut(g),
  hbp:       (g) => onHitByPitch(g),
  ci:        (g) => onCatcherInterference(g),
  ibb:       (g) => onIntentionalWalk(g),
  hit:       (g, p) => (p.reached ? onHit(g, p.reached) : null),
  error:     (g) => onError(g),
  run:       (g) => onRun(g),
  advance:   (g) => onAdvance(g),
  clear:     (g) => onClearBases(g),
  endhalf:   (g) => onEndHalf(g),
  count:     (g) => onResetCount(g),
  batter:    (g) => onNextBatter(g),
  half:      (g) => onToggleHalf(g),
  inning:    (g, p) => (p.inputs ? onNudgeInning(g, p.inputs.d) : null),
  balk:      (g) => onBalk(g),
  bint:      (g, p) => (p.from ? onBatterInterference(g, p.from) : null),
  runner:    (g, p) => (p.from && p.kind ? onRunnerPlay(g, p.from, p.kind) : null),
  base:      (g, p) => (p.inputs && p.inputs.key ? toggleBase(g, p.inputs.key) : null),
  // Built on the pad from their own sheets, so the fold rebuilds them from the
  // numbers those sheets recorded rather than from an action of its own.
  walk:      (g, p) => (p.bases
    ? { type: 'walk', patch: endPA(g, { balls: 0, strikes: 0, bases: safeBases(p.bases), ...runsPatch(g, p.runs | 0) }) }
    : null),
  homerun:   (g, p) => ({ type: 'homerun', patch: homeRunPatch(g, p.runs | 0) }),
  batidx:    (g, p) => (p.side != null && p.i != null
    ? { type: 'batidx', patch: { state: { ...(g.state || {}), batIdx: { ...((g.state && g.state.batIdx) || {}), [p.side]: p.i } } } }
    : null),
  end_game:   (g) => ({ type: 'end_game', patch: { status: 'final', clock_running: false } }),
  reopen_game:(g) => ({ type: 'reopen_game', patch: { status: 'live' } }),
  play:      (g, p) => (p.inputs && p.inputs.kind ? onPlay(g, { kind: p.inputs.kind, pos: p.inputs.pos ?? null, dest: p.inputs.dest }) : null),
  pitchadj:  (g, p) => (p.inputs ? adjustPitch(g, p.inputs.d) : null),
  'adj-outs':    (g, p) => (p.inputs ? adjustOuts(g, p.inputs.d) : null),
  'adj-balls':   (g, p) => (p.inputs ? adjustBalls(g, p.inputs.d) : null),
  'adj-strikes': (g, p) => (p.inputs ? adjustStrikes(g, p.inputs.d) : null),
  'adj-score':   (g, p) => (p.inputs ? adjustScore(g, p.inputs.side, p.inputs.d) : null),
  'adj-hits':    (g, p) => (p.inputs ? adjustHits(g, p.inputs.side, p.inputs.d) : null),
  'adj-errors':  (g, p) => (p.inputs ? adjustErrors(g, p.inputs.side, p.inputs.d) : null),
};
export const REPLAYABLE_TYPES = Object.keys(REBUILD);

// Fold `events` (oldest first) over `start`. `lineups` is passed in because the
// rosters are private and never ride in a snapshot, and the order cannot
// advance without them. Returns the state it arrives at, what it applied and
// what it could not.
export function replay(start, events, lineups = {}) {
  let g = { ...(start || {}), lineups };
  const skipped = [];
  let applied = 0;
  for (const ev of events || []) {
    const build = REBUILD[ev.type];
    const res = build ? build(g, ev.payload || {}) : null;
    if (!res || !res.patch) { skipped.push(ev.type); continue; }
    g = { ...g, ...res.patch, lineups };
    applied++;
  }
  return { state: g, applied, skipped };
}

// The fields a scorer would actually notice being wrong. Deliberately not every
// column: a stinger nonce or a card differing says nothing about the baseball.
const COMPARED = ['inning', 'half', 'outs', 'balls', 'strikes',
  'away_score', 'home_score', 'away_hits', 'home_hits', 'away_errors', 'home_errors'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// What the fold says versus what the row says. Returns one entry per field that
// disagrees, each naming both answers, so a badge can say which.
export function compareGames(folded, row) {
  const out = [];
  if (!folded || !row) return out;
  for (const k of COMPARED) {
    const a = k === 'half' ? folded[k] : (folded[k] | 0);
    const b = k === 'half' ? row[k] : (row[k] | 0);
    if (!same(a, b)) out.push({ field: k, folded: a, row: b });
  }
  const fb = safeBases(folded.bases), rb = safeBases(row.bases);
  if (!same(fb, rb)) out.push({ field: 'bases', folded: fb, row: rb });
  const fi = (folded.state && folded.state.batIdx) || {}, ri = (row.state && row.state.batIdx) || {};
  for (const side of ['away', 'home']) {
    if ((fi[side] | 0) !== (ri[side] | 0)) out.push({ field: `batIdx.${side}`, folded: fi[side] | 0, row: ri[side] | 0 });
  }
  return out;
}

// ---- Manual adjusters (direct edits; undoable via apply_event) -------------
// Each nudges a single field by d, clamped to its DB constraint. A score fix
// also moves the line score (adjustScore); hits and errors are totals only.
const clampAdj = (v, lo, hi) => Math.max(lo, hi == null ? v : Math.min(hi, v));
const sideKey = (side, stat) => (side === 'home' ? 'home_' : 'away_') + stat;
// A run fixed by hand goes in the line score too, in that team's half: the one
// being played if they are at bat, else their last one. Taking one away takes
// it from the latest of their halves that has a run. Other sports keep no
// line score, so only the total moves.
export function adjustScore(g, side, d) {
  const k = sideKey(side, 'score');
  const total = clampAdj((g[k] | 0) + d, 0);
  const patch = { [k]: total };
  if ((g.sport || 'baseball') === 'baseball' && total !== (g[k] | 0)) {
    const half = side === 'home' ? 'bottom' : 'top';
    const inn = g.inning | 0 || 1;
    // Home has not batted yet in the top of an inning, so its latest half is the inning before.
    const last = half === 'bottom' && g.half === 'top' ? inn - 1 : inn;
    const ls = lineScore(g);
    if (d > 0 && last >= 1) { ls[last - 1][half] = (ls[last - 1][half] || 0) + d; patch.line_score = ls; }
    if (d < 0) {
      for (let i = Math.min(last, ls.length) - 1; i >= 0; i--) {
        if ((ls[i][half] | 0) > 0) { ls[i][half] = Math.max(0, (ls[i][half] | 0) + d); patch.line_score = ls; break; }
      }
    }
  }
  return { type: 'adj-score', patch, payload: { inputs: { side, d } } };
}
export function adjustHits(g, side, d)   { const k = sideKey(side, 'hits');   return { type: 'adj-hits',   patch: { [k]: clampAdj((g[k] | 0) + d, 0) }, payload: { inputs: { side, d } } }; }
export function adjustErrors(g, side, d) { const k = sideKey(side, 'errors'); return { type: 'adj-errors', patch: { [k]: clampAdj((g[k] | 0) + d, 0) }, payload: { inputs: { side, d } } }; }
export function adjustOuts(g, d)    { return { type: 'adj-outs',    patch: { outs: clampAdj((g.outs | 0) + d, 0, 3) }, payload: { inputs: { d } } }; }
export function adjustBalls(g, d)   { return { type: 'adj-balls',   patch: { balls: clampAdj((g.balls | 0) + d, 0, 4) }, payload: { inputs: { d } } }; }
export function adjustStrikes(g, d) { return { type: 'adj-strikes', patch: { strikes: clampAdj((g.strikes | 0) + d, 0, 3) }, payload: { inputs: { d } } }; }

// ---- Offline undo ---------------------------------------------------------
// The pad queues writes when the network drops. Undo has to mean the same thing
// then as it does online, so when the server is behind us we undo what is in
// hand instead of asking it to reverse an older play.
//
// `base` is the last row the server confirmed; `entries` are the writes still
// queued for that game, in order, each {kind, patch}. Patches hold ABSOLUTE
// values and the optimistic state was built by merging them onto `base` in
// order — so dropping the newest 'event' and replaying the rest reproduces
// exactly the state before that play. 'field' entries (setup, look, audio) are
// not plays: they are kept and replayed with the rest.
//
// Returns { state, rest, dropped }, or null when there is no queued play to drop.
export function undoPending(base, entries) {
  let i = -1;
  for (let j = entries.length - 1; j >= 0; j--) if (entries[j].kind === 'event') { i = j; break; }
  if (i < 0) return null;
  const rest = entries.slice(0, i).concat(entries.slice(i + 1));
  let state = { ...base };
  for (const w of rest) state = { ...state, ...w.patch };
  return { state, rest, dropped: entries[i] };
}

// ---- Walk-off -------------------------------------------------------------
// Home takes the lead in the bottom of the final (regulation+) inning. Opt-in:
// only when regulation_innings is set (> 0). A predicate, not a trigger — the
// pad decides what stinger a play earns and sends it with the play itself.
export function isWalkoff(before, after) {
  const reg = after.regulation_innings | 0;
  if ((after.sport || 'baseball') !== 'baseball' || !reg) return false;
  return after.half === 'bottom' && (after.inning | 0) >= reg &&
    (after.home_score | 0) > (after.away_score | 0) &&
    (before.home_score | 0) <= (before.away_score | 0);
}

// ---- How it ended (the Final card) -----------------------------------------
// The full-frame Final used to be the Mid-Inning slab with a different word at
// the top. It now says who won and, when it is true, how: a walk-off, or a game
// the run rule ended early. Worked out from the row alone, so the overlay needs
// nothing it does not already have.
//
// A walk-off: the home team won in the bottom half and was not ahead before
// that half's runs — the game ended the moment they took the lead. Regulation
// innings, when set, have to have been reached; a lead taken in the bottom of
// the 2nd of a game called for weather is not a walk-off. The run rule: a
// margin at or past the game's run-rule setting, before regulation was done.
export function finalStory(g) {
  const a = g.away_score | 0, h = g.home_score | 0;
  const winner = a === h ? null : (a > h ? 'away' : 'home');
  const inn = g.inning | 0;
  const reg = g.regulation_innings | 0;
  const ls = Array.isArray(g.line_score) ? g.line_score : [];
  const lastBottom = (ls[inn - 1] && ls[inn - 1].bottom) | 0;
  const baseball = (g.sport || 'baseball') === 'baseball';
  const walkoff = baseball && winner === 'home' && g.half === 'bottom' && lastBottom > 0 &&
    (h - lastBottom) <= a && (!reg || inn >= reg);
  const diff = g.run_rule_diff | 0;
  const runRule = baseball && !walkoff && !!winner && diff > 0 && Math.abs(a - h) >= diff && (!reg || inn < reg);
  return { winner, walkoff, runRule, innings: inn };
}

// ---- The situation, in words ----------------------------------------------
// The situation bar is dots and a diamond — shape, not text — so the button
// around it carries this instead. Pure, because the fiddly parts (one out vs
// two outs, bases loaded, first AND third) are exactly what goes wrong.
const ORDINALS = { 1: '1st', 2: '2nd', 3: '3rd' };
const ordinalOf = (n) => ORDINALS[n] || `${n}th`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export function basesPhrase(b) {
  const on = [b.first && 'first', b.second && 'second', b.third && 'third'].filter(Boolean);
  if (!on.length) return 'bases empty';
  if (on.length === 3) return 'bases loaded';
  return `${on.length === 1 ? 'runner on' : 'runners on'} ${on.join(' and ')}`;
}
export function situationSentence(g) {
  return [
    `${g.half === 'top' ? 'Top' : 'Bottom'} of the ${ordinalOf(g.inning | 0)}`,
    plural(g.balls | 0, 'ball', 'balls'),
    plural(g.strikes | 0, 'strike', 'strikes'),
    plural(g.outs | 0, 'out', 'outs'),
    basesPhrase(safeBases(g.bases)),
  ].join(', ');
}

// Is an inbound server row one the pad has already moved past?
//
// Realtime delivers a burst of UPDATEs when a queued backlog drains, and those
// arrive AFTER the queue reports itself empty. The control pad's handler only
// checks that nothing is still queued, so it repaints each one in turn — walking
// the score forward through its own history. Seen live: after a reconnect the
// pad had settled on 2-0 and then announced "0, 0", "1, 0", "2, 0" again, one
// per delayed row. It ended correct only because delivery happened to be in
// order; a row arriving late enough would put a stale score back on the pad.
//
// Both zero cases degrade to "not stale", which is the old behaviour: a row with
// no usable updated_at, or nothing adopted yet, is adopted.
export function rowStamp(row) {
  const t = row && row.updated_at ? Date.parse(row.updated_at) : NaN;
  return Number.isFinite(t) ? t : 0;
}
export function rowIsStale(row, lastAt) {
  const t = rowStamp(row);
  return !!t && !!lastAt && t < lastAt;
}
