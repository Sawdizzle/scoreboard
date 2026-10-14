// Pure volleyball rules. Current-set points live in home_score/away_score (the
// live headline numbers); sets won, set number, serve, and the per-set target
// live in `state`. Rally scoring: every point flips serve to the scoring team.

export function vbState(g) {
  const s = (g && g.state) || {};
  return {
    set: s.set || 1,
    sets: { away: s.sets?.away || 0, home: s.sets?.home || 0 },
    serve: s.serve ?? null,
    target: s.target || 25,
    history: Array.isArray(s.history) ? s.history : [],
  };
}
const withState = (g, changes) => ({ state: { ...vbState(g), ...changes } });
const scoreKey = (t) => (t === 'home' ? 'home_score' : 'away_score');
const other = (t) => (t === 'home' ? 'away' : 'home');

// Bank a finished set for `team`: sets+1, record the score, next set at 0-0.
// The set winner keeps serve for the next set (correct it if your league rotates).
function bankSet(g, team, finalAway, finalHome) {
  const st = vbState(g);
  const sets = { ...st.sets, [team]: st.sets[team] + 1 };
  const history = [...st.history, { away: finalAway, home: finalHome }];
  return {
    type: 'vb-set',
    patch: { away_score: 0, home_score: 0, ...withState(g, { set: st.set + 1, sets, serve: team, history }) },
    payload: { set: st.set, winner: team, away: finalAway, home: finalHome },
    anim: 'setwin',
    // The winning point never reached the screen: the same commit that scored it
    // put both scores back to 0 for the next set, so viewers saw the sets
    // counter tick over and the score vanish. Send it with the stinger, which is
    // where a broadcast calls out a set score anyway.
    animMeta: { away: finalAway, home: finalHome },
  };
}

// Rally point: +1 and serve to the scoring team. Reaching the target with a
// 2-point lead wins the set automatically.
export function point(g, team) {
  const st = vbState(g);
  const my = (g[scoreKey(team)] | 0) + 1;
  const their = g[scoreKey(other(team))] | 0;
  if (my >= st.target && my - their >= 2) {
    return bankSet(g, team, team === 'away' ? my : their, team === 'home' ? my : their);
  }
  return { type: 'vb-point', patch: { [scoreKey(team)]: my, ...withState(g, { serve: team }) } };
}

// Ace: a service winner — the point goes to whoever is serving.
export function ace(g) {
  const st = vbState(g);
  if (!st.serve) return null; // no server set yet — use the +1 buttons
  const r = point(g, st.serve);
  return { ...r, anim: r.anim || 'ace' };
}

// Manual set end (time-capped or shortened sets): award to the current leader.
export function endSet(g) {
  const a = g.away_score | 0, h = g.home_score | 0;
  if (a === h) return null; // tied — score the deciding point first
  return bankSet(g, h > a ? 'home' : 'away', a, h);
}

export function setServe(g, team) { return { type: 'vb-serve', patch: withState(g, { serve: team }) }; }
// Set target cycles through the common formats: 25 (rally), 21, 15 (deciding set).
export function cycleTarget(g) {
  const next = { 25: 21, 21: 15, 15: 25 };
  const st = vbState(g);
  return { type: 'vb-target', patch: withState(g, { target: next[st.target] || 25 }) };
}
export function adjustSet(g, d) {
  const st = vbState(g);
  return { type: 'vb-setno', patch: withState(g, { set: Math.max(1, st.set + d) }) };
}
export function adjustSets(g, team, d) {
  const st = vbState(g);
  return { type: 'vb-sets', patch: withState(g, { sets: { ...st.sets, [team]: Math.max(0, st.sets[team] + d) } }) };
}
export function manualScore(g, team, d) {
  return { type: 'score', patch: { [scoreKey(team)]: Math.max(0, (g[scoreKey(team)] | 0) + d) } };
}
