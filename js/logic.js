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

export function onStrike(g) {
  const strikes = (g.strikes | 0) + 1;
  // 3rd strike ends the at-bat (pitch + advance batter); earlier strikes just count the pitch.
  if (strikes >= 3) { const res = outResult(g, 'strikeout'); return { ...res, patch: endPA(g, res.patch) }; }
  return { type: 'strike', patch: withPitch(g, { strikes }) };
}

export function onFoul(g) {
  // A foul is always a pitch, even when it doesn't change the count (2 strikes).
  const patch = (g.strikes | 0) >= 2 ? {} : { strikes: (g.strikes | 0) + 1 };
  return { type: 'foul', patch: withPitch(g, patch) };
}

// A ball-in-play out (the OUT button) ends the at-bat: pitch + advance batter.
// Strikeouts go through onStrike, so this path is only in-play outs.
export function onOut(g) { const res = outResult(g, 'out'); return { ...res, patch: endPA(g, res.patch) }; }

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
  return { type: 'advance', patch: { bases, ...runsPatch(g, runs) } };
}

export function onClearBases(g) {
  return { type: 'clear', patch: { bases: { first: false, second: false, third: false } } };
}

export function toggleBase(g, key) {
  const b = safeBases(g.bases);
  return { type: 'base', patch: { bases: { ...b, [key]: !b[key] } } };
}
