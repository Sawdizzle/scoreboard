import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLineup, lineupFromLast, lineupFromRoster, lineupStatus } from '../lib/lineup.ts';
import type { Player, Position } from '../lib/types.ts';

const P = (id: string, number: string, first: string, positions: Position[], active = true): Player =>
  ({ id, team_id: 't', number, first_name: first, last_name: 'Kid', positions, bats: null, throws: null, public_name: 'full', active });
const roster = [
  P('a', '7', 'Ava', ['SS', '2B']), P('b', '3', 'Cy', ['CF']), P('c', '12', 'Ben', ['P', 'SS']),
  P('d', '21', 'Finn', ['C']), P('e', '40', 'Max', ['P'], false), P('f', '9', 'Theo', []),
];

test('from the roster: active players by number, each at the first spot still free', () => {
  const l = lineupFromRoster(roster);
  assert.deepEqual(l.batters.map((b) => b.num), ['3', '7', '9', '12', '21']);
  assert.deepEqual(l.positions, { CF: 'b', SS: 'a', P: 'c', C: 'd' });
  // The rules engine's pitcher copy follows positions.P.
  assert.deepEqual(l.pitcher, { num: '12', name: 'Ben Kid' });
});

test('from last game: anyone gone is dropped with their spot, names refresh', () => {
  const last = { batters: [{ bid: 'e', num: '40', name: 'Max' }, { bid: 'a', num: '77', name: 'Old Name' }, { bid: 'zz', num: '1', name: 'Left team' }],
    positions: { P: 'e', SS: 'a', CF: 'zz' } };
  const l = lineupFromLast(last, roster);
  assert.deepEqual(l.batters, [{ bid: 'a', num: '7', name: 'Ava Kid' }]);
  assert.deepEqual(l.positions, { SS: 'a' });
});

test('status: nine in the order and nine in the field is ready', () => {
  assert.deepEqual(lineupStatus(undefined).ready, false);
  const nine = Array.from({ length: 9 }, (_, i) => ({ bid: `p${i}`, num: String(i + 1), name: '' }));
  const spots = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
  const full = { batters: nine, positions: Object.fromEntries(spots.map((s, i) => [s, `p${i}`])) };
  assert.equal(lineupStatus(full).ready, true);
  const s = lineupStatus({ ...full, positions: { P: 'p0' } });
  assert.equal(s.batters, 9);
  assert.equal(s.missing.length, 8);
});

test('a lineup from the browser is rebuilt from what a lineup may hold', () => {
  const ok = cleanLineup({ batters: [{ bid: 'a', num: '7', name: ' Ava ', extra: 1 }, { bid: 'b', num: '', name: 'Cy' }],
    positions: { SS: 'a', XX: 'b', CF: 'nobody', '2B': 'a' }, sneaky: true });
  assert.deepEqual(ok?.batters, [{ bid: 'a', num: '7', name: 'Ava' }, { bid: 'b', num: '', name: 'Cy' }]);
  assert.deepEqual(ok?.positions, { SS: 'a' });
  assert.equal(cleanLineup({ batters: [{ bid: 'a', num: '7a', name: '' }] }), null);
  assert.equal(cleanLineup({ batters: [{ bid: 'a', num: '1', name: '' }, { bid: 'a', num: '2', name: '' }] }), null);
  assert.equal(cleanLineup({ batters: [{ bid: '<script>', num: '1', name: '' }] }), null);
  assert.equal(cleanLineup({ batters: Array.from({ length: 41 }, (_, i) => ({ bid: `x${i}`, num: '', name: '' })) }), null);
  assert.equal(cleanLineup('nope'), null);
});
