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
// Points have to belong to somebody. Before anyone has tapped a possession
// button there is no answer, and offenseTeam()'s 'home' fallback is a guess —
// one that quietly put six on the wrong team. The scoring actions return null
// instead and let the pad say what to do, the same way an ace refuses when no
// server is set. Kickoff and turnover are exempt: they set possession rather
// than assume it, which is how you tell the pad who has the ball to begin with.
const hasBall = (g) => fbState(g).possession != null;
export function defenseTeam(g) { return offenseTeam(g) === 'home' ? 'away' : 'home'; }
const otherTeam = (t) => (t === 'home' ? 'away' : 'home');
const scoreOf = (g, team, pts) => ({ [team === 'home' ? 'home_score' : 'away_score']: (g[team === 'home' ? 'home_score' : 'away_score'] | 0) + pts });

// After a score or turnover the other team takes over on a new drive: flip
// possession and reset to 1st & 10. Timeouts and quarter are preserved.
function flipDrive(g) {
  const st = fbState(g);
  return { possession: st.possession ? otherTeam(st.possession) : 'home', down: 1, distance: 10 };
}

// Touchdown holds possession for the PAT (the XP / 2-PT flips the drive after).
export function touchdown(g) { return hasBall(g) ? { type: 'td', patch: scoreOf(g, offenseTeam(g), 6), anim: 'touchdown' } : null; }
// FG / XP / 2-PT / safety all end the possession → score, then kickoff to the other team.
export function fieldGoal(g) { return hasBall(g) ? { type: 'fg', patch: { ...scoreOf(g, offenseTeam(g), 3), ...withState(g, flipDrive(g)) }, anim: 'fieldgoal' } : null; }
export function extraPoint(g) { return hasBall(g) ? { type: 'xp', patch: { ...scoreOf(g, offenseTeam(g), 1), ...withState(g, flipDrive(g)) } } : null; }
export function twoPoint(g) { return hasBall(g) ? { type: '2pt', patch: { ...scoreOf(g, offenseTeam(g), 2), ...withState(g, flipDrive(g)) } } : null; }
export function safety(g) { return hasBall(g) ? { type: 'safety', patch: { ...scoreOf(g, defenseTeam(g), 2), ...withState(g, flipDrive(g)) }, anim: 'fieldgoal' } : null; }

// Turnover (INT/fumble): the other team takes over, 1st & 10, with a stinger.
export function turnover(g) { return { type: 'turnover', patch: withState(g, flipDrive(g)), anim: 'turnover' }; }
// Kickoff / change of possession (punt, missed FG, TD with no try): flip, 1st & 10, no points.
export function kickoff(g) { return { type: 'fb-kick', patch: withState(g, flipDrive(g)) }; }

export function manualScore(g, team, d) {
  const key = team === 'home' ? 'home_score' : 'away_score';
  return { type: 'score', patch: { [key]: Math.max(0, (g[key] | 0) + d) } };
}
