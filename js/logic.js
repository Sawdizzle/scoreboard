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
  return {
    balls: 0, strikes: 0,
    bases: { first: false, second: false, third: false },
    ...runsPatch(g, runs),
  };
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
    const patch = { balls: 0, strikes: 0, bases: w.bases, ...runsPatch(g, w.runs) };
    return { type: 'walk', patch, sheet: 'walk', payload: { runs: w.runs } };
  }
  return { type: 'ball', patch: { balls } };
}

export function onStrike(g) {
  const strikes = (g.strikes | 0) + 1;
  if (strikes >= 3) return outResult(g, 'strikeout');
  return { type: 'strike', patch: { strikes } };
}

export function onFoul(g) {
  if ((g.strikes | 0) >= 2) return { type: 'foul', patch: {} }; // foul with 2 strikes: no change
  return { type: 'foul', patch: { strikes: (g.strikes | 0) + 1 } };
}

export function onOut(g) { return outResult(g, 'out'); }

export function onRun(g) { return { type: 'run', patch: runsPatch(g, 1) }; }

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

// Next Batter: clears the count and, if the batting team has a lineup, advances
// that team's current-hitter index (stored in state.batIdx) to the next filled slot.
export function onNextBatter(g) {
  const patch = { balls: 0, strikes: 0 };
  const side = battingSide(g);
  const t = (g.lineups || {})[side] || {};
  const batters = Array.isArray(t.batters) ? t.batters : [];
  if (batters.some((b) => b && (b.name || b.num))) {
    const bi = (g.state && g.state.batIdx) || {};
    const next = nextFilledIdx(batters, bi[side] | 0);
    patch.state = { ...(g.state || {}), batIdx: { ...bi, [side]: next } };
  }
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
