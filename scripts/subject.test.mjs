// Every event says who it was about — js/logic.js `stamp`.
//
// This is the first stage of moving the game onto its event log. The rule it
// protects is the one that cost a season of scrambled lineups: only a terminal
// BATTER event ends a plate appearance, so an out recorded on a runner leaves
// the count, the hitter and the batting order alone.
//
// The walk below is the point of the file. It calls EVERY exported action with
// a real game and fails if any of them produces an event with no subject, so an
// action added next month cannot ship unstamped — which is exactly how the
// batter/runner confusion got in the first time.
//
// Run: node --test scripts/subject.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load-module.mjs';

const L = await loadModule('js/logic.js');

const bases = (f, s, t) => ({ first: !!f, second: !!s, third: !!t });
const order = (n) => ({ batters: Array.from({ length: n }, (_, i) => ({ num: String(i + 1), name: 'B' + i })) });
const G = (over = {}) => ({
  id: 'g1', sport: 'baseball', half: 'top', inning: 1,
  balls: 1, strikes: 1, outs: 0, bases: bases(1, 0, 0),
  away_score: 0, home_score: 0, away_hits: 0, home_hits: 0, away_errors: 0, home_errors: 0,
  line_score: [], state: { batIdx: { away: 0 } }, lineups: { away: order(9) }, regulation_innings: 0, ...over,
});

// ---------------------------------------------------------------------------
// The walk: no exported action may produce an unstamped event
// ---------------------------------------------------------------------------
// Arguments for the actions that need more than a game row. An export missing
// from here is called with the game alone.
const ARGS = {
  onStrike: [{ looking: true }],
  onHit: [2],
  onRunnerPlay: ['first', 'CS'],
  onNudgeInning: [1],
  onPlay: [{ kind: 'GB', pos: 'SS', dest: { batter: 'out', first: 2 } }],
  adjustPitch: [1],
  adjustScore: ['away', 1],
  adjustHits: ['away', 1],
  adjustErrors: ['away', 1],
  adjustOuts: [1],
  adjustBalls: [1],
  adjustStrikes: [1],
};
test('every exported action produces an event with a subject', () => {
  const g = G();
  const actions = Object.keys(L).filter((k) => /^(on|adjust)[A-Z]/.test(k) && typeof L[k] === 'function');
  assert.ok(actions.length >= 18, `expected the full set of actions, found ${actions.length}`);
  const unstamped = [];
  for (const name of actions) {
    const res = L[name](g, ...(ARGS[name] || []));
    if (!res) continue;                       // an action that declines (a blocked runner play)
    const out = L.stamp(res, g);
    const subject = out.payload && out.payload.subject;
    if (!subject || !L.SUBJECTS.includes(subject)) unstamped.push(`${name} → ${JSON.stringify(subject)}`);
  }
  assert.deepEqual(unstamped, [], 'these actions produced an event that belongs to nobody');
});

// ---------------------------------------------------------------------------
// The subjects themselves
// ---------------------------------------------------------------------------
const subjectOf = (res) => L.stamp(res, G()).payload.subject;

test('what happens to the batter belongs to the batter', () => {
  const g = G();
  assert.equal(subjectOf(L.onBall(g)), 'batter');
  assert.equal(subjectOf(L.onStrike(g)), 'batter');
  assert.equal(subjectOf(L.onFoul(g)), 'batter');
  assert.equal(subjectOf(L.onOut(g)), 'batter');
  assert.equal(subjectOf(L.onHit(g, 1)), 'batter');
  assert.equal(subjectOf(L.onHitByPitch(g)), 'batter');
  assert.equal(subjectOf(L.onStrike(G({ strikes: 2 }))), 'batter', 'a strikeout too');
  assert.equal(subjectOf(L.onPlay(g, { kind: 'GB', pos: 'SS', dest: { batter: 'out', first: 2 } })), 'batter');
});

test('a play on the bases belongs to the runner who was on that base', () => {
  const g = G({ bases: bases(1, 1, 0) });
  assert.equal(subjectOf(L.onRunnerPlay(g, 'first', 'CS')), 'runner@first');
  assert.equal(subjectOf(L.onRunnerPlay(g, 'second', 'PO')), 'runner@second');
  assert.equal(subjectOf(L.onRunnerPlay(g, 'second', 'SB')), 'runner@second');
  assert.equal(subjectOf(L.onRunnerPlay(G({ bases: bases(0, 0, 1) }), 'third', 'SB')), 'runner@third');
});

test('the caught stealing that started all this is not a batter event', () => {
  const r = L.onRunnerPlay(G(), 'first', 'CS');
  assert.equal(subjectOf(r), 'runner@first');
  assert.notEqual(subjectOf(r), 'batter');
  assert.equal(r.patch.state, undefined, 'and so it moves no order');
  assert.equal(r.patch.balls, undefined, 'and clears no count');
});

test('corrections and inning moves belong to the game, not to a person', () => {
  const g = G();
  assert.equal(subjectOf(L.onEndHalf(g)), 'game');
  assert.equal(subjectOf(L.onNudgeInning(g, 1)), 'game');
  assert.equal(subjectOf(L.onResetCount(g)), 'game');
  assert.equal(subjectOf(L.onRun(g)), 'game');
  assert.equal(subjectOf(L.adjustOuts(g, 1)), 'game');
  assert.equal(subjectOf(L.adjustScore(g, 'away', 1)), 'game');
});

test('advancing everyone belongs to the runners', () => {
  assert.equal(subjectOf(L.onAdvance(G())), 'runners');
});

// ---------------------------------------------------------------------------
// Stamping rules
// ---------------------------------------------------------------------------
test('stamping keeps the rest of the event exactly as it was', () => {
  const r = L.onHit(G(), 2);
  const out = L.stamp(r, G());
  assert.deepEqual(out.patch, r.patch);
  assert.equal(out.type, r.type);
  assert.equal(out.payload.runs, r.payload.runs, 'the payload it already had survives');
});

test('stamping twice changes nothing', () => {
  const once = L.stamp(L.onOut(G()), G());
  assert.deepEqual(L.stamp(once, G()), once);
});

test('an action that names its own subject keeps it', () => {
  const out = L.stamp({ type: 'out', patch: { outs: 1 }, payload: { subject: 'runner@third' } }, G());
  assert.equal(out.payload.subject, 'runner@third');
});

test('a subject nobody recognises is replaced, not trusted', () => {
  const out = L.stamp({ type: 'out', patch: { outs: 1 }, payload: { subject: 'the umpire' } }, G());
  assert.equal(out.payload.subject, 'batter');
});

test('a runner play carries the base and the kind, so a replay can read it back', () => {
  const r = L.onRunnerPlay(G(), 'first', 'CS');
  assert.equal(r.payload.from, 'first');
  assert.equal(r.payload.kind, 'CS');
});
