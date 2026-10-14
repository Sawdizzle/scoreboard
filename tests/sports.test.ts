// What the pad and the stream say about the other sports, around v4's rules
// (tests/rules/sports.test.mjs guards the rules themselves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Football as F, periodName, periodText, situationText, soccerSeconds, sportGame, timeoutsOf, Volleyball as V } from '../lib/sports.ts';

const names = { away: 'River', home: 'Steel' };

test('period text, per sport', () => {
  assert.equal(periodText('football', { state: { quarter: 2 } }), 'Q2');
  assert.equal(periodText('football', { state: { quarter: 5 } }), 'OT');
  assert.equal(periodName('football', { state: { quarter: 3 } }), '3rd quarter');
  assert.equal(periodText('basketball', { state: { period: 6 } }), 'OT2');
  assert.equal(periodText('soccer', { state: { half: 2 } }), '2nd half');
  assert.equal(periodText('volleyball', { state: { set: 3, sets: { away: 1, home: 1 } } }), 'Set 3 · sets 1-1');
  // A v5 game made before the rules came over kept its period as `period`.
  assert.equal(periodText('soccer', { state: { period: 2 } }), '2nd half');
});

test('football: down and distance, and who has the ball', () => {
  let g = sportGame({}, { period_minutes: 12 });
  assert.equal(F.touchdown(g), null, 'no points before anyone has the ball');
  g = { ...g, ...F.setPossession(g, 'home').patch };
  g = { ...g, ...F.setDown(g, 3).patch };
  assert.equal(situationText('football', g, names), 'Steel ball · 3rd & 10');
  assert.deepEqual(timeoutsOf('football', g), { home: 3, away: 3 });
  assert.equal(F.nextQuarter(g).patch.clock_remaining_seconds, 720, 'the period length reaches the rules');
});

test('volleyball and soccer situations', () => {
  const g = { ...sportGame({}), ...V.setServe(sportGame({}), 'away').patch };
  assert.equal(situationText('volleyball', g, names), 'River serving · to 25');
  assert.equal(situationText('soccer', { state: { stoppage: 3, cards: { home: { y: 1, r: 0 } } } }, names), '+3 · Steel 🟨');
  const t0 = Date.parse('2026-10-14T18:00:00Z');
  assert.equal(soccerSeconds({ state: { clock: { running: true, base: 60, since: new Date(t0).toISOString() } } }, t0 + 30_000), 90);
});
