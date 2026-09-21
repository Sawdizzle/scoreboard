// The fold — js/logic.js `replay` / `compareGames`.
//
// Stage 2 of moving the game onto its log. The fold re-runs the same actions
// the pad ran, with the arguments each event recorded, and the pad compares the
// answer to the live row. These tests are the fold's own proof: a game played
// through the actions must come back identical when rebuilt from its events.
//
// Run: node --test scripts/replay.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load-module.mjs';

const L = await loadModule('js/logic.js');

const bases = (f, s, t) => ({ first: !!f, second: !!s, third: !!t });
const order = (n) => ({ batters: Array.from({ length: n }, (_, i) => ({ num: String(i + 1), name: 'B' + i })) });
const LINEUPS = { away: order(9), home: order(9) };
const G = (over = {}) => ({
  id: 'g1', sport: 'baseball', half: 'top', inning: 1,
  balls: 0, strikes: 0, outs: 0, bases: bases(0, 0, 0),
  away_score: 0, home_score: 0, away_hits: 0, home_hits: 0, away_errors: 0, home_errors: 0,
  line_score: [], state: { batIdx: { away: 0, home: 0 }, pitches: {} }, lineups: LINEUPS,
  regulation_innings: 0, ...over,
});

// Play a game the way the pad does: run the action, keep the event it produced,
// merge its patch. Returns the state the pad ended at and the log it wrote.
function play(start, taps) {
  let g = start;
  const events = [];
  for (const tap of taps) {
    const res = L.stamp(tap(g), g);
    if (!res || !res.patch) continue;
    events.push({ type: res.type, payload: res.payload || {} });
    g = { ...g, ...res.patch };
  }
  return { state: g, events };
}

// ---------------------------------------------------------------------------
// The fold agrees with the pad
// ---------------------------------------------------------------------------
test('a half inning rebuilt from its events matches the state the pad reached', () => {
  const start = G();
  const { state, events } = play(start, [
    (g) => L.onBall(g),
    (g) => L.onStrike(g),
    (g) => L.onFoul(g),
    (g) => L.onHit(g, 1),
    (g) => L.onRunnerPlay(g, 'first', 'SB'),
    (g) => L.onBall(g),
    (g) => L.onOut(g),
    (g) => L.onHit(g, 2),
    (g) => L.onStrike(g, { looking: true }),
  ]);
  const r = L.replay(start, events, LINEUPS);
  assert.deepEqual(r.skipped, [], 'every event was rebuildable');
  assert.equal(r.applied, events.length);
  assert.deepEqual(L.compareGames(r.state, state), [], 'the fold and the pad agree on every field');
});

test('a full inning with a play, an error and a rolled half agrees too', () => {
  const start = G();
  const { state, events } = play(start, [
    (g) => L.onHit(g, 1),
    (g) => L.onPlay(g, { kind: 'GB', pos: 'SS', dest: { batter: 'out', first: 2 } }),
    (g) => L.onError(g),
    (g) => L.onHitByPitch(g),
    (g) => L.onCatcherInterference(g),
    (g) => L.onIntentionalWalk(g),
    (g) => L.onBalk(g),
    (g) => L.onBatterInterference(g, 'second'),
    (g) => L.onPlay(g, { kind: 'DP', pos: '6', dest: { batter: 'out', first: 'out' } }),
    (g) => L.onOut(g),
    (g) => L.onBall(g),
    (g) => L.onHit(g, 3),
  ]);
  const r = L.replay(start, events, LINEUPS);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(L.compareGames(r.state, state), []);
});

test('corrections replay as corrections', () => {
  const start = G({ outs: 1, balls: 2, strikes: 1 });
  const { state, events } = play(start, [
    (g) => L.adjustOuts(g, -1),
    (g) => L.adjustBalls(g, 1),
    (g) => L.adjustScore(g, 'away', 2),
    (g) => L.adjustHits(g, 'home', 1),
    (g) => L.adjustErrors(g, 'away', 1),
    (g) => L.onNudgeInning(g, 1),
    (g) => L.onResetCount(g),
    (g) => L.onNextBatter(g),
  ]);
  const r = L.replay(start, events, LINEUPS);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(L.compareGames(r.state, state), []);
});

// ---------------------------------------------------------------------------
// The bug this whole rework exists for
// ---------------------------------------------------------------------------
test('a caught stealing folds without moving the order; an out on the batter moves it', () => {
  const start = G({ bases: bases(1, 0, 0), balls: 1, strikes: 1 });
  const steal = play(start, [(g) => L.onRunnerPlay(g, 'first', 'CS')]);
  const rs = L.replay(start, steal.events, LINEUPS);
  assert.equal(rs.state.state.batIdx.away, 0, 'the hitter is still the hitter');
  assert.equal(rs.state.balls, 1, 'and the count is untouched');
  assert.deepEqual(L.compareGames(rs.state, steal.state), []);

  const out = play(start, [(g) => L.onOut(g)]);
  const ro = L.replay(start, out.events, LINEUPS);
  assert.equal(ro.state.state.batIdx.away, 1, 'a batter out does move the order');
  assert.deepEqual(L.compareGames(ro.state, out.state), []);
});

// ---------------------------------------------------------------------------
// Starting mid-game, which is what the trimmed log forces
// ---------------------------------------------------------------------------
test('the fold starts from a snapshot, not from the first pitch', () => {
  const mid = G({ inning: 4, half: 'bottom', outs: 1, away_score: 3, home_score: 2,
    bases: bases(0, 1, 0), state: { batIdx: { away: 5, home: 2 }, pitches: { away: 51 } },
    line_score: [{ top: 1, bottom: 0 }, { top: 0, bottom: 2 }, { top: 2, bottom: 0 }, { top: 0, bottom: 0 }] });
  const { state, events } = play(mid, [
    (g) => L.onBall(g),
    (g) => L.onHit(g, 1),
    (g) => L.onRunnerPlay(g, 'second', 'CS'),
    (g) => L.onOut(g),
  ]);
  const r = L.replay(mid, events, LINEUPS);
  assert.deepEqual(L.compareGames(r.state, state), []);
  assert.equal(r.state.state.batIdx.home, state.state.batIdx.home);
});

// ---------------------------------------------------------------------------
// Honesty about what it cannot do
// ---------------------------------------------------------------------------
// Coverage: every type the pad can commit should be rebuildable, or the badge
// will read "partial" for the rest of its life and tell us nothing.
test('every event type the pad writes has a rebuild', () => {
  const written = ['ball', 'strike', 'foul', 'strikeout', 'out', 'hbp', 'hit', 'error', 'run', 'runner',
    'play', 'walk', 'homerun', 'base', 'clear', 'advance', 'endhalf', 'half', 'inning', 'count',
    'batter', 'batidx', 'pitchadj', 'end_game', 'reopen_game',
    'adj-outs', 'adj-balls', 'adj-strikes', 'adj-score', 'adj-hits', 'adj-errors'];
  const missing = written.filter((t) => !L.REPLAYABLE_TYPES.includes(t));
  assert.deepEqual(missing, [], 'these event types would make the fold partial forever');
});

test('a base toggled by hand folds back', () => {
  const start = G();
  const { state, events } = play(start, [(g) => L.toggleBase(g, 'second'), (g) => L.toggleBase(g, 'third')]);
  const r = L.replay(start, events, LINEUPS);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(L.compareGames(r.state, state), []);
});

test('a walk and a home run off their sheets fold back', () => {
  const start = G({ bases: bases(1, 1, 0) });
  const w = L.computeWalk(start.bases);
  const walkEvent = { type: 'walk', payload: { runs: w.runs, bases: w.bases } };
  const afterWalk = { ...start, ...L.endPA(start, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(start, w.runs) }) };
  const hrEvent = { type: 'homerun', payload: { runs: 3 } };
  const afterHr = { ...afterWalk, ...L.homeRunPatch(afterWalk, 3) };
  const r = L.replay(start, [walkEvent, hrEvent], LINEUPS);
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(L.compareGames(r.state, afterHr), []);
});

test('setting the hitter by hand folds back', () => {
  const start = G();
  const r = L.replay(start, [{ type: 'batidx', payload: { side: 'away', i: 4 } }], LINEUPS);
  assert.equal(r.state.state.batIdx.away, 4);
  assert.deepEqual(r.skipped, []);
});

test('an event it cannot rebuild is reported, never guessed', () => {
  const start = G();
  const r = L.replay(start, [{ type: 'ball', payload: {} }, { type: 'sponsor', payload: {} }, { type: 'obs', payload: {} }], LINEUPS);
  assert.equal(r.applied, 1);
  assert.deepEqual(r.skipped, ['sponsor', 'obs']);
});

test('an event missing the inputs it needs is skipped rather than invented', () => {
  const start = G({ bases: bases(1, 0, 0) });
  const r = L.replay(start, [{ type: 'play', payload: {} }, { type: 'runner', payload: {} }], LINEUPS);
  assert.equal(r.applied, 0);
  assert.deepEqual(r.skipped, ['play', 'runner']);
});

test('folding no events at all returns the snapshot it started from', () => {
  const start = G({ outs: 2 });
  const r = L.replay(start, [], LINEUPS);
  assert.deepEqual(L.compareGames(r.state, start), []);
  assert.equal(r.applied, 0);
});

// ---------------------------------------------------------------------------
// The comparison itself
// ---------------------------------------------------------------------------
test('a disagreement names the field and both answers', () => {
  const diff = L.compareGames(G({ outs: 2 }), G({ outs: 1 }));
  assert.deepEqual(diff, [{ field: 'outs', folded: 2, row: 1 }]);
});

test('the order drifting a spot is exactly what the badge must catch', () => {
  const folded = G({ state: { batIdx: { away: 3, home: 0 } } });
  const row = G({ state: { batIdx: { away: 4, home: 0 } } });
  assert.deepEqual(L.compareGames(folded, row), [{ field: 'batIdx.away', folded: 3, row: 4 }]);
});

test('runners on different bases disagree', () => {
  const diff = L.compareGames(G({ bases: bases(1, 0, 0) }), G({ bases: bases(0, 1, 0) }));
  assert.equal(diff.length, 1);
  assert.equal(diff[0].field, 'bases');
});

test('cosmetics are not baseball, and are not compared', () => {
  const a = G({ current_animation: { type: 'run', nonce: 1 }, rally_mode: true, theme: 'dark' });
  const b = G({ current_animation: null, rally_mode: false, theme: 'light' });
  assert.deepEqual(L.compareGames(a, b), []);
});
