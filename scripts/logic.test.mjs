// Unit tests for the pure rules in js/logic.js. No dependencies: `node --test`.
//
// logic.js is a .js ES module in a repo with no package.json, so Node would read
// it as CommonJS — copy it to a .mjs and import that, the same trick check.mjs
// uses for its syntax pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const tmp = mkdtempSync(join(tmpdir(), 'sbtest-'));
const dest = join(tmp, 'logic.mjs');
writeFileSync(dest, readFileSync(join(root, 'js/logic.js'), 'utf8'));
const L = await import(dest);

// ---------------------------------------------------------------------------
// undoPending — the offline half of Undo (BUG-2).
//
// Undo used to call the server RPC unconditionally. With writes still queued
// that reverses an OLDER play than the last one scored, and then the queue
// replays its absolute patches straight back over the reversal. These cover the
// arithmetic that replaces it.
// ---------------------------------------------------------------------------
const ev = (patch) => ({ kind: 'event', patch });
const field = (patch) => ({ kind: 'field', patch });

test('drops the newest queued play and rebuilds the state before it', () => {
  const base = { id: 'g1', balls: 0, strikes: 0 };
  const q = [ev({ balls: 1 }), ev({ balls: 2 }), ev({ balls: 3 })];
  const r = L.undoPending(base, q);
  assert.equal(r.state.balls, 2, 'three balls, undone once, is two');
  assert.equal(r.rest.length, 2);
  assert.equal(r.dropped, q[2], 'drops the entry it says it dropped');
  assert.deepEqual(q.length, 3, 'does not mutate the caller queue');
});

test('undoes repeatedly, one play at a time', () => {
  const base = { id: 'g1', balls: 0 };
  let q = [ev({ balls: 1 }), ev({ balls: 2 }), ev({ balls: 3 })];
  let r = L.undoPending(base, q);       assert.equal(r.state.balls, 2);
  r = L.undoPending(base, r.rest);      assert.equal(r.state.balls, 1);
  r = L.undoPending(base, r.rest);      assert.equal(r.state.balls, 0, 'back to the confirmed row');
  assert.equal(L.undoPending(base, r.rest), null, 'and then there is nothing left to undo');
});

test('keeps settings writes queued — they are not plays', () => {
  const base = { id: 'g1', balls: 0, theme: 'nightgame' };
  const q = [ev({ balls: 1 }), field({ theme: 'chalkboard' }), ev({ balls: 2 })];
  const r = L.undoPending(base, q);
  assert.equal(r.state.balls, 1, 'the play is undone');
  assert.equal(r.state.theme, 'chalkboard', 'the theme change survives it');
  assert.equal(r.rest.length, 2);
  assert.ok(r.rest.some((w) => w.kind === 'field'), 'and is still queued to save');
});

test('a settings write after the last play does not become the undo target', () => {
  const base = { id: 'g1', balls: 0, theme: 'nightgame' };
  const q = [ev({ balls: 1 }), field({ theme: 'chalkboard' })];
  const r = L.undoPending(base, q);
  assert.equal(r.dropped.kind, 'event');
  assert.equal(r.state.balls, 0);
  assert.equal(r.state.theme, 'chalkboard');
});

test('returns null when only settings are queued, so Undo can say so', () => {
  assert.equal(L.undoPending({ id: 'g1' }, [field({ theme: 'neon' })]), null);
  assert.equal(L.undoPending({ id: 'g1' }, []), null);
});

test('replays onto the baseline as it advances mid-drain', () => {
  // Two plays queued; the first is accepted, so the baseline moves to it and
  // only the second is still queued. Undo must land on the accepted row, not
  // on the row we were at when the network dropped.
  const afterFirst = { id: 'g1', balls: 1 };
  const r = L.undoPending(afterFirst, [ev({ balls: 2 })]);
  assert.equal(r.state.balls, 1);
  assert.equal(r.rest.length, 0);
});

test('carries every field of a multi-field patch, not just the changed one', () => {
  const base = { id: 'g1', outs: 0, balls: 3, strikes: 2, half: 'top', inning: 1 };
  // A third out rolls the half-inning: one patch, many absolute fields.
  const roll = ev({ outs: 0, balls: 0, strikes: 0, half: 'bottom', inning: 1 });
  const r = L.undoPending(base, [roll]);
  assert.deepEqual(r.state, base, 'undoing the roll restores every field it touched');
});

// ---------------------------------------------------------------------------
// A few of the baseball rules the pad depends on, as a starting point.
// ---------------------------------------------------------------------------
test('a walk forces runners only where it has to', () => {
  assert.deepEqual(L.computeWalk({ first: false, second: false, third: false }),
    { bases: { first: true, second: false, third: false }, runs: 0 });
  assert.deepEqual(L.computeWalk({ first: true, second: false, third: true }),
    { bases: { first: true, second: true, third: true }, runs: 0 }, 'first and third: nobody scores');
  assert.deepEqual(L.computeWalk({ first: true, second: true, third: true }),
    { bases: { first: true, second: true, third: true }, runs: 1 }, 'bases loaded forces one in');
});

test('a home run scores the batter and everyone on', () => {
  assert.equal(L.computeHomeRun({ first: false, second: false, third: false }).runs, 1);
  assert.equal(L.computeHomeRun({ first: true, second: true, third: true }).runs, 4);
});

// ---------------------------------------------------------------------------
// isWalkoff — moved here from control.js when the stinger stopped being a
// separate write (PERF-1) and became part of the play's own patch.
// ---------------------------------------------------------------------------
const g = (o) => ({ sport: 'baseball', regulation_innings: 6, half: 'bottom', inning: 6, home_score: 0, away_score: 0, ...o });

test('a walk-off is home taking the lead in the bottom of the final inning', () => {
  assert.equal(L.isWalkoff(g({ home_score: 2, away_score: 3 }), g({ home_score: 4, away_score: 3 })), true);
});

test('extra innings still count as the final inning or later', () => {
  assert.equal(L.isWalkoff(g({ inning: 9, home_score: 3, away_score: 3 }), g({ inning: 9, home_score: 4, away_score: 3 })), true);
});

test('not a walk-off when home was already ahead', () => {
  assert.equal(L.isWalkoff(g({ home_score: 5, away_score: 3 }), g({ home_score: 6, away_score: 3 })), false);
});

test('not a walk-off in the top half, before the final inning, or when tied', () => {
  assert.equal(L.isWalkoff(g({ half: 'top', home_score: 2, away_score: 3 }), g({ half: 'top', home_score: 4, away_score: 3 })), false, 'top half');
  assert.equal(L.isWalkoff(g({ inning: 3, home_score: 2, away_score: 3 }), g({ inning: 3, home_score: 4, away_score: 3 })), false, 'third inning');
  assert.equal(L.isWalkoff(g({ home_score: 2, away_score: 3 }), g({ home_score: 3, away_score: 3 })), false, 'only tied it');
});

test('opt-in: no regulation length set means no walk-off, ever', () => {
  const off = { regulation_innings: 0 };
  assert.equal(L.isWalkoff(g({ ...off, home_score: 2, away_score: 3 }), g({ ...off, home_score: 4, away_score: 3 })), false);
});

test('walk-off is baseball only', () => {
  const fb = { sport: 'football' };
  assert.equal(L.isWalkoff(g({ ...fb, home_score: 2, away_score: 3 }), g({ ...fb, home_score: 4, away_score: 3 })), false);
});
