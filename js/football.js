// Pure football rules. Situation lives in the game's `state` jsonb; score in
// home_score/away_score; the quarter clock reuses the shared countdown fields.
// Each action returns { type, patch, anim? }; patch.state is the FULL new state
// (apply_event replaces the state column wholesale).

export function fbState(g) {
  const s = (g && g.state) || {};
  return {
    quarter: s.quarter || 1,
    down: s.down || 1,
    distance: s.distance === 'goal' ? 'goal' : (s.distance ?? 10),
    possession: s.possession ?? null,
    home_timeouts: s.home_timeouts ?? 3,
    away_timeouts: s.away_timeouts ?? 3,
  };
}
const withState = (g, changes) => ({ state: { ...fbState(g), ...changes } });

export function setPossession(g, team) { return { type: 'fb-poss', patch: withState(g, { possession: team }) }; }
export function setDown(g, n) { return { type: 'fb-down', patch: withState(g, { down: n }) }; }
export function distanceDelta(g, d) {
  const st = fbState(g);
  const cur = st.distance === 'goal' ? 10 : st.distance;
  return { type: 'fb-dist', patch: withState(g, { distance: Math.max(1, Math.min(99, cur + d)) }) };
}
export function setGoal(g) { return { type: 'fb-dist', patch: withState(g, { distance: 'goal' }) }; }
export function firstDown(g) { return { type: 'fb-first', patch: withState(g, { down: 1, distance: 10 }) }; }
export function timeout(g, team) {
  const st = fbState(g); const key = team === 'home' ? 'home_timeouts' : 'away_timeouts';
  return { type: 'fb-to', patch: withState(g, { [key]: Math.max(0, st[key] - 1) }) };
}
export function resetTimeouts(g) { return { type: 'fb-to', patch: withState(g, { home_timeouts: 3, away_timeouts: 3 }) }; }
export function nextQuarter(g) {
  const st = fbState(g);
  return { type: 'fb-quarter', patch: { ...withState(g, { quarter: st.quarter + 1 }), clock_running: false, clock_ends_at: null, clock_remaining_seconds: g.time_limit_seconds } };
}

export function offenseTeam(g) { return fbState(g).possession || 'home'; }
export function defenseTeam(g) { return offenseTeam(g) === 'home' ? 'away' : 'home'; }
const scoreOf = (g, team, pts) => ({ [team === 'home' ? 'home_score' : 'away_score']: (g[team === 'home' ? 'home_score' : 'away_score'] | 0) + pts });

export function touchdown(g) { return { type: 'td', patch: scoreOf(g, offenseTeam(g), 6), anim: 'touchdown' }; }
export function fieldGoal(g) { return { type: 'fg', patch: scoreOf(g, offenseTeam(g), 3), anim: 'fieldgoal' }; }
export function extraPoint(g) { return { type: 'xp', patch: scoreOf(g, offenseTeam(g), 1) }; }
export function twoPoint(g) { return { type: '2pt', patch: scoreOf(g, offenseTeam(g), 2) }; }
export function safety(g) { return { type: 'safety', patch: scoreOf(g, defenseTeam(g), 2), anim: 'fieldgoal' }; }
export function manualScore(g, team, d) {
  const key = team === 'home' ? 'home_score' : 'away_score';
  return { type: 'score', patch: { [key]: Math.max(0, (g[key] | 0) + d) } };
}
