// Pure basketball rules. Points in home_score/away_score; period, team fouls,
// and timeouts in `state`. The game clock reuses the shared countdown fields
// (set the quarter length as the time limit; Next Period resets it).

export function bkState(g) {
  const s = (g && g.state) || {};
  return {
    period: s.period || 1,
    fouls: { away: s.fouls?.away || 0, home: s.fouls?.home || 0 },
    timeouts: { away: s.timeouts?.away ?? 4, home: s.timeouts?.home ?? 4 },
  };
}
const withState = (g, changes) => ({ state: { ...bkState(g), ...changes } });
const scoreKey = (t) => (t === 'home' ? 'home_score' : 'away_score');

// FT +1 / FG +2 / three +3 (the three fires its own stinger). Negative pts
// allowed for corrections; floors at 0.
export function score(g, team, pts) {
  const key = scoreKey(team);
  return {
    type: 'bk-score',
    patch: { [key]: Math.max(0, (g[key] | 0) + pts) },
    payload: { team, pts },
    anim: pts === 3 ? 'three' : null,
  };
}

// Team fouls (NFHS bonus display: 1-and-1 at 7, double bonus at 10).
export function foul(g, team, d = 1) {
  const st = bkState(g);
  return { type: 'bk-foul', patch: withState(g, { fouls: { ...st.fouls, [team]: Math.max(0, st.fouls[team] + d) } }) };
}
export const BONUS_AT = 7, DOUBLE_BONUS_AT = 10;
export function bonusOf(st, team) {
  const f = st.fouls[team === 'home' ? 'away' : 'home']; // opponent fouls put YOU in the bonus
  return f >= DOUBLE_BONUS_AT ? 'BONUS+' : f >= BONUS_AT ? 'BONUS' : '';
}

// Next period: fouls reset, clock reloads the period length.
export function nextPeriod(g) {
  const st = bkState(g);
  return {
    type: 'bk-period',
    patch: {
      ...withState(g, { period: st.period + 1, fouls: { away: 0, home: 0 } }),
      clock_running: false, clock_ends_at: null, clock_remaining_seconds: g.time_limit_seconds,
    },
  };
}
export function adjustPeriod(g, d) {
  const st = bkState(g);
  return { type: 'bk-period', patch: withState(g, { period: Math.max(1, st.period + d) }) };
}

export function timeout(g, team) {
  const st = bkState(g);
  return { type: 'bk-to', patch: withState(g, { timeouts: { ...st.timeouts, [team]: Math.max(0, st.timeouts[team] - 1) } }) };
}
export function resetTimeouts(g) {
  return { type: 'bk-to', patch: withState(g, { timeouts: { away: 4, home: 4 } }) };
}
