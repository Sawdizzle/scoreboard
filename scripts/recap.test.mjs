// The half, replayed — js/logic.js `finishedHalf` / `halfRecap`.
//
// Mid-Inning replays the half that just ended from the public play-by-play.
// These pin down which half that is (the third out has already rolled the row
// by the time the card goes up) and what the strip says about it.
//
// Run: node --test scripts/recap.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load-module.mjs';

const L = await loadModule('js/logic.js');

const play = (inning, half, kind, over = {}) => ({ inning, half, kind, pos: null, code: '', outs: 0, runs: 0, ...over });

// ---------------------------------------------------------------------------
// Which half just ended
// ---------------------------------------------------------------------------
test('in the bottom of an inning, the top of it has just ended', () => {
  assert.deepEqual(L.finishedHalf({ inning: 3, half: 'bottom' }), { inning: 3, half: 'top' });
});

test('in the top of an inning, the bottom of the one before has just ended', () => {
  assert.deepEqual(L.finishedHalf({ inning: 4, half: 'top' }), { inning: 3, half: 'bottom' });
});

test('the top of the first has nothing before it, and does not invent an inning 0', () => {
  assert.deepEqual(L.finishedHalf({ inning: 1, half: 'top' }), { inning: 1, half: 'bottom' });
});

// ---------------------------------------------------------------------------
// What the strip says
// ---------------------------------------------------------------------------
const game = { inning: 3, half: 'bottom' };   // Middle of the 3rd: the top just ended
const busy = [
  play(2, 'bottom', 'GB', { code: '6-3', outs: 1 }),          // an earlier half, left out
  play(3, 'top', 'H1'),
  play(3, 'top', 'BB'),
  play(3, 'top', 'K', { code: 'K', outs: 1 }),
  play(3, 'top', 'H2', { runs: 2 }),
  play(3, 'top', 'GB', { code: '6-3', outs: 1 }),
  play(3, 'top', 'FB', { code: 'F8', outs: 1 }),
];

test('only the half that just ended is replayed, in the order it happened', () => {
  const r = L.halfRecap(busy, game);
  assert.equal(r.inning, 3);
  assert.equal(r.half, 'top');
  assert.deepEqual(r.rows.map((x) => x.kind), ['H1', 'BB', 'K', 'H2', 'GB', 'FB']);
});

test('the summary counts the runs, the hits and the walks', () => {
  const r = L.halfRecap(busy, game);
  assert.equal(r.runs, 2);
  assert.equal(r.hits, 2);
  assert.equal(r.walks, 1);
  assert.equal(r.outs, 3);
  assert.equal(r.oneTwoThree, false);
});

test('each chip carries its label, its code, and the outs and runs on it', () => {
  const [single, walk, k, dbl, gb, fb] = L.halfRecap(busy, game).rows;
  assert.equal(single.label, 'Single');
  assert.equal(walk.label, 'Walk');
  assert.equal(dbl.runs, 2);
  assert.equal(gb.code, '6-3');
  assert.equal(fb.code, 'F8');
  assert.equal(gb.outs, 1);
  assert.equal(k.k, true);
  assert.equal(k.label, 'Strikeout', 'the K in front says swinging; the label does not repeat it');
  assert.equal(k.code, '', 'and the K is not printed twice');
});

test('a called third strike reads as the reversed K', () => {
  const r = L.halfRecap([play(3, 'top', 'KL', { code: 'K', outs: 1 })], game);
  assert.equal(r.rows[0].k, true);
  assert.equal(r.rows[0].backwards, true);
  assert.equal(r.rows[0].label, 'Strikeout looking');
});

test('three up, three down is a 1-2-3 inning', () => {
  const r = L.halfRecap([
    play(3, 'top', 'KL', { outs: 1 }),
    play(3, 'top', 'GB', { code: '4-3', outs: 1 }),
    play(3, 'top', 'PU', { code: 'P6', outs: 1 }),
  ], game);
  assert.equal(r.oneTwoThree, true);
});

test('three outs around a single are not a 1-2-3 inning', () => {
  const r = L.halfRecap([
    play(3, 'top', 'H1'),
    play(3, 'top', 'DP', { code: '6-4-3', outs: 2 }),
    play(3, 'top', 'FB', { code: 'F9', outs: 1 }),
  ], game);
  assert.equal(r.oneTwoThree, false, 'three plays and three outs, but somebody reached');
});

test('a double play that ends it in three plays is not a 1-2-3 inning either', () => {
  const r = L.halfRecap([
    play(3, 'top', 'BB'),
    play(3, 'top', 'DP', { code: '6-4-3', outs: 2 }),
    play(3, 'top', 'GB', { code: '5-3', outs: 1 }),
  ], game);
  assert.equal(r.oneTwoThree, false);
});

test('no plays for the half is an empty strip, not an error', () => {
  const r = L.halfRecap([], game);
  assert.deepEqual(r.rows, []);
  assert.equal(r.oneTwoThree, false);
  assert.deepEqual(L.halfRecap(null, game).rows, []);
});
