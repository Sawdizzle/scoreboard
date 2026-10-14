// The other sports: score, period, sets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPoints, endSet, periodText, sportDef, stepPeriod } from '../lib/sports.ts';

test('points go on and come off, never below zero', () => {
  assert.deepEqual(addPoints({ home_score: 7 }, 'home', 6, 'Touchdown'), { type: 'score', patch: { home_score: 13 }, text: 'Touchdown +6' });
  assert.deepEqual(addPoints({ away_score: 1 }, 'away', -3)?.patch, { away_score: 0 });
  assert.equal(addPoints({}, 'away', -1), null);
});

test('periods step within the game, with overtime', () => {
  assert.deepEqual(stepPeriod('football', {}, 1)?.patch, { state: { period: 2 } });
  assert.equal(stepPeriod('football', {}, -1), null);
  assert.equal(stepPeriod('basketball', { state: { period: 4 } }, 1)?.text, 'Overtime');
  assert.equal(sportDef('soccer').name(2), '2nd half');
  assert.equal(periodText('football', { state: { period: 3 } }), 'Q3');
});

test('volleyball: a set goes to the side ahead and the score starts over', () => {
  const r = endSet({ home_score: 25, away_score: 21, state: { period: 1 } })!;
  assert.deepEqual(r.patch, { home_score: 0, away_score: 0, state: { period: 2, sets: { home: 1, away: 0 }, setLog: [{ home: 25, away: 21 }] } });
  assert.equal(endSet({ home_score: 10, away_score: 10 }), null);
  assert.equal(periodText('volleyball', r.patch as never), 'Set 2 · sets 0-1');
});
