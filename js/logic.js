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
    ? { home_runs: (g.home_runs | 0) + n, line_score: ls }
    : { away_runs: (g.away_runs | 0) + n, line_score: ls };
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

export function onNextBatter(g) { return { type: 'batter', patch: { balls: 0, strikes: 0 } }; }

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
