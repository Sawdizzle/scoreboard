// Pure baseball rules. Each action takes the current game row and returns
// { type, patch, payload?, sheet? }. `patch` = fields to merge (sent to the
// apply_event RPC, which snapshots prev_state for undo). No side effects here.

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
  return { type: 'inning', patch: { inning, line_score: lineScore({ ...g, inning }) } };
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
  const strikes = (g.strikes | 0) + 1;
  // 3rd strike ends the at-bat (pitch + advance batter); earlier strikes just count the pitch.
  if (strikes >= 3) {
    const res = outResult(g, 'strikeout');
    return { ...res, patch: endPA(g, res.patch), payload: { ...(res.payload || {}), play: playNote(g, looking ? 'KL' : 'K', { outs: 1 }) },
      anim: looking ? 'strikeoutlooking' : 'strikeout' };
  }
  return { type: 'strike', patch: withPitch(g, { strikes }) };
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
    payload: { runs: w.runs, play: playNote(g, 'HBP', { runs: w.runs }) } };
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
export function onRunnerPlay(g, from, kind) {
  if (!RUNNER_LABEL[kind] || runnerBlocked(g, from, kind)) return null;
  const b = safeBases(g.bases);
  const bases = { ...b, [from]: false };
  if (kind === 'CS' || kind === 'PO') {
    const outs = (g.outs | 0) + 1;
    const patch = outs >= 3 ? endHalfPatch({ ...g, bases }) : { outs, bases };
    return { type: 'runner', patch, payload: { play: playNote(g, kind, { outs: 1 }) },
      anim: 'play', animMeta: { text: RUNNER_LABEL[kind] }, text: RUNNER_LABEL[kind] };
  }
  const to = NEXT_BASE[from];
  const runs = to ? 0 : 1;
  if (to) bases[to] = true;
  const text = kind === 'SB' ? (to ? `Stole ${to === 'second' ? '2nd' : '3rd'}` : 'Stole home') : RUNNER_LABEL[kind];
  return { type: 'runner', patch: { bases, ...runsPatch(g, runs) }, payload: { runs, play: playNote(g, kind, { runs }) },
    anim: kind === 'SB' ? 'stolenbase' : runs ? 'run' : null, animMeta: {}, text };
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
const filled = (b) => !!(b && (b.name || b.num));
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
// The 9 field spots. P is always the team's pitcher; the other 8 map to a
// batting-order index via lineups[side].positions = { C: idx, '1B': idx, ... }.
export const FIELD_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
export function teamPositions(g, side) {
  return (g.lineups && g.lineups[side] && g.lineups[side].positions) || {};
}
// Resolve a position to its {num,name}, or null if unset. P = the pitcher box.
export function fielderAt(g, side, pos) {
  if (pos === 'P') { const p = teamLineup(g, side).pitcher; return filled(p) ? p : null; }
  const idx = teamPositions(g, side)[pos];
  if (idx == null) return null;
  const b = teamLineup(g, side).batters[idx];
  return filled(b) ? b : null;
}

// Swap two batting-order slots in a team's roster blob (lineups[side]). Field
// positions point at batting-order indices, so they are re-pointed to follow the
// player — a fielder moved from 7th to 2nd keeps their spot on the diamond. The
// pitcher is matched by num+name, not index, so it needs nothing. Returns a new
// blob; the at-bat pointer (state.batIdx) is a slot, not a player, and is untouched.
export function swapBatters(team, a, b) {
  const t = team || {};
  const batters = Array.isArray(t.batters) ? t.batters.slice() : [];
  if (a === b || a < 0 || b < 0) return { ...t, batters };
  while (batters.length <= Math.max(a, b)) batters.push({ num: '', name: '' });
  [batters[a], batters[b]] = [batters[b], batters[a]];
  const out = { ...t, batters };
  if (t.positions) {
    out.positions = {};
    for (const [pos, idx] of Object.entries(t.positions)) out.positions[pos] = idx === a ? b : idx === b ? a : idx;
  }
  return out;
}

// ---- Positions from the lineup sheet ---------------------------------------
// Every row in the lineup sheet has a position dropdown. The pitcher is stored
// as {num, name} — the convention the overlay's cards and the pad's "vs P" line
// already read — and the other eight point at batting-order indices. These keep
// the two in step, so picking P from a row makes that player the pitcher.
export function pitcherIdx(team) {
  const t = team || {};
  const p = t.pitcher || {};
  if (!(p.num || p.name)) return -1;
  const bs = Array.isArray(t.batters) ? t.batters : [];
  return bs.findIndex((b) => b && (b.num || '') === (p.num || '') && (b.name || '') === (p.name || ''));
}
// What a batting-order slot plays: 'P', a field spot, or '' (not in the field).
export function positionOf(team, idx) {
  if (pitcherIdx(team) === idx) return 'P';
  const hit = Object.entries((team && team.positions) || {}).find(([, i]) => i === idx);
  return hit ? hit[0] : '';
}
// Put slot `idx` at `pos` ('' = not in the field). Whoever held that spot goes
// to the bench rather than trading places: the dropdown says where THIS player
// plays, and quietly moving someone else to a new spot would be a surprise.
// Returns the new roster blob and the benched slot, or -1.
export function setPosition(team, idx, pos) {
  const t = team || {};
  const batters = Array.isArray(t.batters) ? t.batters : [];
  const positions = { ...(t.positions || {}) };
  let pitcher = t.pitcher || { num: '', name: '' };
  let benched = -1;
  const pi = pitcherIdx(t);
  for (const k of Object.keys(positions)) if (positions[k] === idx) delete positions[k];
  if (pi === idx) pitcher = { num: '', name: '' };
  if (pos === 'P') {
    if (pi >= 0 && pi !== idx) benched = pi;
    const b = batters[idx] || {};
    pitcher = { num: b.num || '', name: b.name || '' };
  } else if (FIELD_POSITIONS.includes(pos)) {
    if (positions[pos] != null && positions[pos] !== idx) benched = positions[pos];
    positions[pos] = idx;
  }
  return { team: { ...t, positions, pitcher }, benched };
}
// The Field screen: put lineup slot `idx` at `pos`, and the kid who had `pos`
// TRADES into idx's old spot. Kids rotate far more often than they sit, so this
// is one tap per move. A kid coming off the bench (no old spot) sends the one he
// replaces to the bench. Returns the team and who moved as a side effect, if anyone.
export function assignSpot(team, pos, idx) {
  const from = positionOf(team, idx);
  if (from === pos) return { team, moved: null };
  const r = setPosition(team, idx, pos);
  if (r.benched < 0) return { team: r.team, moved: null };
  if (!from) return { team: r.team, moved: { idx: r.benched, to: '' } };
  return { team: setPosition(r.team, r.benched, from).team, moved: { idx: r.benched, to: from } };
}
// Which lineup slot plays `pos`, or -1.
export function slotAt(team, pos) {
  const t = team || {};
  if (pos === 'P') return pitcherIdx(t);
  const i = (t.positions || {})[pos];
  return i == null ? -1 : i;
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
export const HALF_STARTERS = new Set(['ball', 'strike', 'foul', 'strikeout', 'walk', 'hbp', 'hit', 'play', 'homerun', 'runner', 'run', 'error']);

// The spots nobody fills yet, in field order — the sheet's field check.
export function missingPositions(team) {
  const t = team || {};
  const batters = Array.isArray(t.batters) ? t.batters : [];
  const p = t.pitcher || {};
  return FIELD_POSITIONS.filter((pos) => {
    if (pos === 'P') return !(p.num || p.name);
    const i = (t.positions || {})[pos];
    return i == null || !filled(batters[i]);
  });
}
// One typed field on one row, written over the stored roster.
//
// This replaced mergeLineupEdits, which took all fifteen rows as they stood in
// the DOM. The sheet skipped refilling its inputs while one of them had focus,
// so a roster changed underneath (a position trade, a drag, a pull from the
// server) left the other fourteen rows holding pre-change text — and the next
// blur wrote that whole stale side back. Names vanished and the order reverted
// mid-game with nobody editing. A single field can only ever carry the edit the
// operator actually made.
//
// The pitcher is a copy of a row's name and number, so an edit to that row
// carries the pitcher with it instead of orphaning the mound.
export function setBatterField(stored, idx, field, value) {
  const t = stored || {};
  if (idx < 0 || (field !== 'num' && field !== 'name')) return t;
  const batters = Array.isArray(t.batters) ? t.batters.slice() : [];
  while (batters.length <= idx) batters.push({ num: '', name: '' });
  const pi = pitcherIdx(t);
  batters[idx] = { ...(batters[idx] || {}), [field]: value };
  const out = { ...t, batters };
  if (pi === idx) { const b = batters[idx]; out.pitcher = { num: b.num || '', name: b.name || '' }; }
  return out;
}

// Ordered batting lineup for a side, each row tagged with its fielding position
// (P for the pitcher, the assigned spot, or '' for DH/unset) and whether it's the
// hitter at bat — for the lineup broadcast card.
export function battingOrderCard(g, side) {
  const t = teamLineup(g, side);
  const positions = teamPositions(g, side);
  const posByIdx = {};
  for (const [pos, idx] of Object.entries(positions)) posByIdx[idx] = pos;
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
export function adjustPitch(g, d) {
  const side = fieldingSide(g);
  const cur = (g.state && g.state.pitches) || {};
  const next = Math.max(0, (cur[side] | 0) + d);
  return { type: 'pitchadj', patch: { state: { ...(g.state || {}), pitches: { ...cur, [side]: next } } } };
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

// Advance the batting team's lineup index to the next filled slot. Returns the
// new batIdx map, or null if that team has no lineup entered.
function advanceBatterState(g) {
  const side = battingSide(g);
  const t = (g.lineups || {})[side] || {};
  const batters = Array.isArray(t.batters) ? t.batters : [];
  if (!batters.some((b) => b && (b.name || b.num))) return null;
  const bi = (g.state && g.state.batIdx) || {};
  return { ...bi, [side]: nextFilledIdx(batters, bi[side] | 0) };
}

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
  return { type: 'base', patch: { bases: { ...b, [key]: !b[key] } } };
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
  FC: 'Fielder’s choice', DP: 'Double play', SF: 'Sac fly', K3: 'Dropped 3rd strike',
  H1: 'Single', H2: 'Double', H3: 'Triple',
  // Recorded for the play-by-play by their own buttons, not the ball-in-play sheet.
  K: 'Strikeout swinging', KL: 'Strikeout looking', BB: 'Walk', HBP: 'Hit by pitch',
  SB: 'Stolen base', CS: 'Caught stealing', PO: 'Picked off', ADV: 'Runner advanced', HR: 'Home run', OUT: 'Out',
};

// The name-free note an at-bat leaves in the event payload, which apply_event
// copies into the public play-by-play. The inning and half are the ones the
// play happened in — a third out has rolled them by the time the row saves.
export function playNote(g, kind, { pos = null, code = '', outs = 0, runs = 0 } = {}) {
  return { kind, pos, code, outs, runs, inning: g.inning | 0, half: g.half };
}

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
    patch: endPA(g, patch),
    payload: { runs, play: playNote(g, kind, { pos, code, outs: r.outs, runs }) },
    anim: kind === 'DP' ? 'doubleplay' : kind === 'H3' ? 'bigplay' : 'play',
    animMeta: { text, side, idx: currentBatterIdx(g, side), runs },
    text,
  };
}

// ---- Manual adjusters (direct edits; undoable via apply_event) -------------
// Each nudges a single field by d, clamped to its DB constraint. Score/hits/
// errors adjust the running total only (line score is left to game-flow plays).
const clampAdj = (v, lo, hi) => Math.max(lo, hi == null ? v : Math.min(hi, v));
const sideKey = (side, stat) => (side === 'home' ? 'home_' : 'away_') + stat;
export function adjustScore(g, side, d)  { const k = sideKey(side, 'score');  return { type: 'adj-score',  patch: { [k]: clampAdj((g[k] | 0) + d, 0) } }; }
export function adjustHits(g, side, d)   { const k = sideKey(side, 'hits');   return { type: 'adj-hits',   patch: { [k]: clampAdj((g[k] | 0) + d, 0) } }; }
export function adjustErrors(g, side, d) { const k = sideKey(side, 'errors'); return { type: 'adj-errors', patch: { [k]: clampAdj((g[k] | 0) + d, 0) } }; }
export function adjustOuts(g, d)    { return { type: 'adj-outs',    patch: { outs: clampAdj((g.outs | 0) + d, 0, 3) } }; }
export function adjustBalls(g, d)   { return { type: 'adj-balls',   patch: { balls: clampAdj((g.balls | 0) + d, 0, 4) } }; }
export function adjustStrikes(g, d) { return { type: 'adj-strikes', patch: { strikes: clampAdj((g.strikes | 0) + d, 0, 3) } }; }

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
