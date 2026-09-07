// Pure soccer rules. Situation in `state` jsonb; goals in home_score/away_score.
// The match clock counts UP, so it lives in state.clock {running, base, since}
// (base = accumulated seconds; since = ISO timestamp of the current run segment)
// rather than the shared countdown fields.

// How long a half runs. Comes from the game's period length — the same field
// football and basketball already use for a quarter — with 45 minutes only as
// the fallback. It used to be hardcoded at 45, which is the one length youth
// soccer never plays: halves run 25, 30 or 35 by age group, so the second-half
// clock started at the wrong number on air for essentially every game this app
// exists to cover.
export const DEFAULT_HALF_SECONDS = 45 * 60;
export function halfSeconds(g) {
  const n = (g && g.time_limit_seconds) | 0;
  return n > 0 ? n : DEFAULT_HALF_SECONDS;
}

export function scState(g) {
  const s = (g && g.state) || {};
  const c = s.clock || {};
  return {
    half: s.half || 1,
    stoppage: s.stoppage || 0,
    cards: {
      home: { y: s.cards?.home?.y || 0, r: s.cards?.home?.r || 0 },
      away: { y: s.cards?.away?.y || 0, r: s.cards?.away?.r || 0 },
    },
    clock: { running: !!c.running, base: c.base || 0, since: c.since || null },
  };
}
export function elapsedSeconds(g, nowMs) {
  const c = scState(g).clock;
  return c.running && c.since ? c.base + (nowMs - new Date(c.since).getTime()) / 1000 : c.base;
}
const withState = (g, changes) => ({ state: { ...scState(g), ...changes } });

export function goal(g, team) {
  const key = team === 'home' ? 'home_score' : 'away_score';
  return { type: 'goal', patch: { [key]: (g[key] | 0) + 1 }, anim: 'goal' };
}
export function manualScore(g, team, d) {
  const key = team === 'home' ? 'home_score' : 'away_score';
  return { type: 'score', patch: { [key]: Math.max(0, (g[key] | 0) + d) } };
}
export function setHalf(g, n) {
  const base = n === 2 ? halfSeconds(g) : 0;
  return { type: 'sc-half', patch: withState(g, { half: n, stoppage: 0, clock: { running: false, base, since: null } }) };
}
export function card(g, team, color) {
  const st = scState(g);
  const cards = { home: { ...st.cards.home }, away: { ...st.cards.away } };
  cards[team][color] += 1;
  return { type: 'sc-card', patch: withState(g, { cards }) };
}
export function stoppageDelta(g, d) {
  const st = scState(g);
  return { type: 'sc-stop', patch: withState(g, { stoppage: Math.max(0, st.stoppage + d) }) };
}

export function clockStart(g, nowIso) {
  const c = scState(g).clock;
  return { type: 'sc-clk', patch: withState(g, { clock: { running: true, base: c.base, since: nowIso } }) };
}
export function clockPause(g, nowMs) {
  return { type: 'sc-clk', patch: withState(g, { clock: { running: false, base: elapsedSeconds(g, nowMs), since: null } }) };
}
export function clockReset(g) {
  const st = scState(g);
  return { type: 'sc-clk', patch: withState(g, { clock: { running: false, base: st.half === 2 ? halfSeconds(g) : 0, since: null } }) };
}
