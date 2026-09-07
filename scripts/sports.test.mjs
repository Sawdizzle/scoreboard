// Football, soccer, volleyball and basketball rules.
//
// Same shape as the baseball rules: a game row in, a patch out, no DOM and no
// network. Each module owns the situation in `state` and the score in
// home_score/away_score, and patch.state is always the FULL new state because
// apply_event replaces that column wholesale — so these tests check what
// survives a patch as much as what changes.
//
// Run: node --test scripts/sports.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load-module.mjs';

const F = await loadModule('js/football.js');
const S = await loadModule('js/soccer.js');
const V = await loadModule('js/volleyball.js');
const B = await loadModule('js/basketball.js');

const G = (over = {}) => ({ id: 'g1', home_score: 0, away_score: 0, state: {}, time_limit_seconds: 720, ...over });

// ===========================================================================
// Football
// ===========================================================================
test('football starts 1st & 10, three timeouts, nobody with the ball', () => {
  assert.deepEqual(F.fbState(G()), {
    quarter: 1, down: 1, distance: 10, possession: null, home_timeouts: 3, away_timeouts: 3,
  });
});

test('a touchdown keeps possession, because the try is still coming', () => {
  const g = G({ state: { possession: 'away', down: 3, distance: 4 } });
  const r = F.touchdown(g);
  assert.equal(r.patch.away_score, 6);
  assert.equal(r.anim, 'touchdown');
  assert.equal(r.patch.state, undefined, 'down and distance are left for the try');
});

test('the try, the field goal and the safety all end the drive', () => {
  const g = G({ state: { possession: 'away', down: 3, distance: 4 } });
  for (const [fn, pts, who] of [[F.extraPoint, 1, 'away_score'], [F.twoPoint, 2, 'away_score'], [F.fieldGoal, 3, 'away_score']]) {
    const r = fn(g);
    assert.equal(r.patch[who], pts, fn.name);
    assert.equal(r.patch.state.possession, 'home', fn.name + ' flips possession');
    assert.deepEqual([r.patch.state.down, r.patch.state.distance], [1, 10], fn.name + ' resets to 1st & 10');
  }
});

test('a safety scores for the defense', () => {
  const r = F.safety(G({ state: { possession: 'away' } }));
  assert.equal(r.patch.home_score, 2, 'home was defending');
  assert.equal(r.patch.state.possession, 'home', 'and gets the ball');
});

test('a turnover flips the ball with no points', () => {
  const r = F.turnover(G({ state: { possession: 'home', down: 4, distance: 2 } }));
  assert.equal(r.patch.state.possession, 'away');
  assert.deepEqual([r.patch.state.down, r.patch.state.distance], [1, 10]);
  assert.equal(r.patch.home_score, undefined);
  assert.equal(r.anim, 'turnover');
});

test('distance clamps to a real number of yards, and & Goal counts as ten', () => {
  assert.equal(F.distanceDelta(G({ state: { distance: 1 } }), -5).patch.state.distance, 1);
  assert.equal(F.distanceDelta(G({ state: { distance: 99 } }), 5).patch.state.distance, 99);
  assert.equal(F.distanceDelta(G({ state: { distance: 'goal' } }), -3).patch.state.distance, 7);
  assert.equal(F.setGoal(G()).patch.state.distance, 'goal');
});

test('a first down is 1st & 10 without touching possession', () => {
  const r = F.firstDown(G({ state: { possession: 'home', down: 3, distance: 8 } }));
  assert.deepEqual([r.patch.state.down, r.patch.state.distance, r.patch.state.possession], [1, 10, 'home']);
});

test('timeouts count down to zero and no further', () => {
  assert.equal(F.timeout(G({ state: { home_timeouts: 1 } }), 'home').patch.state.home_timeouts, 0);
  assert.equal(F.timeout(G({ state: { home_timeouts: 0 } }), 'home').patch.state.home_timeouts, 0);
  assert.equal(F.timeout(G(), 'home').patch.state.away_timeouts, 3, 'the other team keeps theirs');
  assert.deepEqual(
    [F.resetTimeouts(G()).patch.state.home_timeouts, F.resetTimeouts(G()).patch.state.away_timeouts], [3, 3]);
});

test('the next quarter reloads the clock and stops it', () => {
  const r = F.nextQuarter(G({ state: { quarter: 2 }, time_limit_seconds: 720 }));
  assert.equal(r.patch.state.quarter, 3);
  assert.equal(r.patch.clock_running, false);
  assert.equal(r.patch.clock_remaining_seconds, 720);
  assert.equal(r.patch.clock_ends_at, null);
});

test('manual score corrections floor at zero', () => {
  assert.equal(F.manualScore(G({ home_score: 0 }), 'home', -1).patch.home_score, 0);
  assert.equal(F.manualScore(G({ home_score: 7 }), 'home', 1).patch.home_score, 8);
});

test('BUG-8: scoring with no possession set silently credits home', { todo: 'open finding — should refuse and toast, the way an ace does with no server set' }, () => {
  assert.equal(F.touchdown(G()).patch.home_score, undefined);
});

// ===========================================================================
// Soccer
// ===========================================================================
test('a goal scores one and fires the celebration', () => {
  const r = S.goal(G(), 'home');
  assert.equal(r.patch.home_score, 1);
  assert.equal(r.anim, 'goal');
});

test('cards accumulate per team and colour, leaving the rest alone', () => {
  let g = G();
  g = { ...g, ...S.card(g, 'away', 'y').patch };
  g = { ...g, ...S.card(g, 'away', 'y').patch };
  g = { ...g, ...S.card(g, 'home', 'r').patch };
  assert.deepEqual(S.scState(g).cards, { home: { y: 0, r: 1 }, away: { y: 2, r: 0 } });
});

test('stoppage time never goes negative', () => {
  assert.equal(S.stoppageDelta(G({ state: { stoppage: 0 } }), -1).patch.state.stoppage, 0);
  assert.equal(S.stoppageDelta(G({ state: { stoppage: 3 } }), 1).patch.state.stoppage, 4);
});

test('the match clock counts up from where it was paused', () => {
  const t0 = Date.parse('2026-09-06T19:00:00Z');
  let g = G({ state: S.scState(G()) });
  g = { ...g, ...S.clockStart(g, new Date(t0).toISOString()).patch };
  assert.equal(Math.round(S.elapsedSeconds(g, t0 + 90_000)), 90);
  g = { ...g, ...S.clockPause(g, t0 + 90_000).patch };
  assert.equal(Math.round(S.elapsedSeconds(g, t0 + 500_000)), 90, 'a paused clock does not keep running');
  g = { ...g, ...S.clockStart(g, new Date(t0 + 500_000).toISOString()).patch };
  assert.equal(Math.round(S.elapsedSeconds(g, t0 + 530_000)), 120, 'and resumes from where it stopped');
});

test('the second half starts at 45:00 and clears stoppage', () => {
  // UI-5 (open): 45 minutes is hardcoded, which is wrong for every youth age group.
  const r = S.setHalf(G({ state: { stoppage: 4 } }), 2);
  assert.equal(r.patch.state.clock.base, 45 * 60);
  assert.equal(r.patch.state.stoppage, 0);
  assert.equal(r.patch.state.clock.running, false);
});

test('resetting the clock returns to the start of the current half', () => {
  assert.equal(S.clockReset(G({ state: { half: 1 } })).patch.state.clock.base, 0);
  assert.equal(S.clockReset(G({ state: { half: 2 } })).patch.state.clock.base, 45 * 60);
});

// ===========================================================================
// Volleyball
// ===========================================================================
test('volleyball starts at set 1, to 25, nobody serving', () => {
  assert.deepEqual(V.vbState(G()), { set: 1, sets: { away: 0, home: 0 }, serve: null, target: 25, history: [] });
});

test('rally scoring: the point goes to the scorer and so does the serve', () => {
  const r = V.point(G({ away_score: 4, home_score: 6, state: { serve: 'home' } }), 'away');
  assert.equal(r.patch.away_score, 5);
  assert.equal(r.patch.state.serve, 'away');
});

test('reaching the target with two clear points wins the set', () => {
  const r = V.point(G({ home_score: 24, away_score: 15, state: { serve: 'home' } }), 'home');
  assert.equal(r.type, 'vb-set');
  assert.deepEqual([r.patch.away_score, r.patch.home_score], [0, 0], 'the next set starts level');
  assert.equal(r.patch.state.sets.home, 1);
  assert.equal(r.patch.state.set, 2);
  assert.equal(r.patch.state.serve, 'home', 'the set winner serves first');
  assert.deepEqual(r.patch.state.history, [{ away: 15, home: 25 }]);
  assert.equal(r.anim, 'setwin');
});

test('25-24 is not a set — it plays on to two', () => {
  const r = V.point(G({ home_score: 24, away_score: 24, state: { serve: 'home' } }), 'home');
  assert.equal(r.type, 'vb-point');
  assert.equal(r.patch.home_score, 25);
  const deuce = V.point(G({ home_score: 25, away_score: 24, state: { serve: 'home' } }), 'home');
  assert.equal(deuce.type, 'vb-set', 'and ends at 26-24');
});

test('an ace needs a server, and scores for whoever has it', () => {
  assert.equal(V.ace(G()), null, 'no server set: refuse rather than guess');
  const r = V.ace(G({ state: { serve: 'away' }, away_score: 3 }));
  assert.equal(r.patch.away_score, 4);
  assert.equal(r.anim, 'ace');
});

test('an ace that wins the set keeps the set-win stinger', () => {
  const r = V.ace(G({ state: { serve: 'home', target: 25 }, home_score: 24, away_score: 10 }));
  assert.equal(r.type, 'vb-set');
  assert.equal(r.anim, 'setwin', 'the bigger moment wins');
});

test('ending a set by hand awards it to whoever is ahead, and refuses a tie', () => {
  assert.equal(V.endSet(G({ away_score: 18, home_score: 18 })), null);
  const r = V.endSet(G({ away_score: 21, home_score: 18 }));
  assert.equal(r.patch.state.sets.away, 1);
  assert.deepEqual(r.patch.state.history, [{ away: 21, home: 18 }]);
});

test('the set target cycles through the formats a league actually uses', () => {
  assert.equal(V.cycleTarget(G({ state: { target: 25 } })).patch.state.target, 21);
  assert.equal(V.cycleTarget(G({ state: { target: 21 } })).patch.state.target, 15);
  assert.equal(V.cycleTarget(G({ state: { target: 15 } })).patch.state.target, 25);
});

test('a deciding set to 15 wins at 15, not 25', () => {
  const r = V.point(G({ home_score: 14, away_score: 9, state: { target: 15, serve: 'home' } }), 'home');
  assert.equal(r.type, 'vb-set');
});

test('set and sets-won steppers floor sensibly', () => {
  assert.equal(V.adjustSet(G({ state: { set: 1 } }), -1).patch.state.set, 1);
  assert.equal(V.adjustSets(G({ state: { sets: { away: 0, home: 0 } } }), 'away', -1).patch.state.sets.away, 0);
});

// ===========================================================================
// Basketball
// ===========================================================================
test('basketball starts at period 1 with four timeouts and no fouls', () => {
  assert.deepEqual(B.bkState(G()), { period: 1, fouls: { away: 0, home: 0 }, timeouts: { away: 4, home: 4 } });
});

test('only a three earns a stinger', () => {
  assert.equal(B.score(G(), 'home', 3).anim, 'three');
  assert.equal(B.score(G(), 'home', 2).anim, null);
  assert.equal(B.score(G(), 'home', 1).anim, null);
  assert.equal(B.score(G({ home_score: 10 }), 'home', 3).patch.home_score, 13);
});

test('a correction cannot push a score below zero', () => {
  assert.equal(B.score(G({ home_score: 1 }), 'home', -2).patch.home_score, 0);
});

test('the bonus is driven by the OTHER team\'s fouls', () => {
  const st = { period: 1, fouls: { away: 7, home: 2 }, timeouts: { away: 4, home: 4 } };
  assert.equal(B.bonusOf(st, 'home'), 'BONUS', 'away has seven, so home shoots');
  assert.equal(B.bonusOf(st, 'away'), '');
  assert.equal(B.bonusOf({ ...st, fouls: { away: 10, home: 2 } }, 'home'), 'BONUS+');
  assert.equal(B.bonusOf({ ...st, fouls: { away: 6, home: 2 } }, 'home'), '', 'six is not yet the bonus');
});

test('team fouls go up and down but not below zero', () => {
  assert.equal(B.foul(G({ state: { fouls: { away: 0, home: 3 } } }), 'home', 1).patch.state.fouls.home, 4);
  assert.equal(B.foul(G({ state: { fouls: { away: 0, home: 0 } } }), 'home', -1).patch.state.fouls.home, 0);
});

test('the next period resets team fouls and reloads the clock', () => {
  const r = B.nextPeriod(G({ state: { period: 2, fouls: { away: 8, home: 5 } }, time_limit_seconds: 480 }));
  assert.equal(r.patch.state.period, 3);
  assert.deepEqual(r.patch.state.fouls, { away: 0, home: 0 });
  assert.equal(r.patch.clock_remaining_seconds, 480);
  assert.equal(r.patch.clock_running, false);
});

test('nudging the period does not reset fouls — it is a correction, not a period change', () => {
  const r = B.adjustPeriod(G({ state: { period: 3, fouls: { away: 8, home: 5 } } }), -1);
  assert.equal(r.patch.state.period, 2);
  assert.deepEqual(r.patch.state.fouls, { away: 8, home: 5 });
  assert.equal(B.adjustPeriod(G({ state: { period: 1 } }), -1).patch.state.period, 1, 'and never below the first');
});

test('basketball timeouts floor at zero and reset to four', () => {
  assert.equal(B.timeout(G({ state: { timeouts: { away: 0, home: 0 } } }), 'home').patch.state.timeouts.home, 0);
  assert.deepEqual(B.resetTimeouts(G()).patch.state.timeouts, { away: 4, home: 4 });
});
