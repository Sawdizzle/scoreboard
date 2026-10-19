import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchFrom, cleanLineup, lineupFromLast, lineupFromRoster, lineupStatus, placeBatter, placeFromCard } from '../lib/lineup.ts';
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

// ---- From the card ----------------------------------------------------------
const order = () => ({
  batters: [{ bid: 'a', num: '7', name: 'Ava' }, { bid: 'b', num: '3', name: 'Cy' }, { bid: 'c', num: '12', name: 'Ben' }],
  positions: { SS: 'a', CF: 'b', P: 'c' },
});
const benchKids = [{ bid: 'f', num: '9', name: 'Theo' }];

test('card: a number already in the order moves up to the cursor, never doubles', () => {
  const r = placeFromCard(order(), 0, '12', benchKids);
  assert.ok(r.ok);
  assert.deepEqual(r.team.batters.map((b) => b.bid), ['c', 'a', 'b']);
  assert.equal(r.team.batters.length, 3);
  assert.equal(r.at, 0);
  // Kept his spot: no position given.
  assert.equal(r.team.positions.P, 'c');
});

test('card: a position with the number puts the kid there, and the old holder comes out', () => {
  const r = placeFromCard(order(), 0, '3', benchKids, 'SS');
  assert.ok(r.ok);
  assert.equal(r.team.positions.SS, 'b');
  assert.equal(r.team.positions.CF, undefined);
  assert.ok(!Object.values(r.team.positions).includes('a'));
  // '' takes them out of the field: an extra hitter.
  const dh = placeFromCard(order(), 0, '7', benchKids, '');
  assert.ok(dh.ok);
  assert.ok(!Object.values(dh.team.positions).includes('a'));
});

test('card: the bench joins at the cursor; placed and unknown numbers are said so', () => {
  const r = placeFromCard(order(), 1, '9', benchKids);
  assert.ok(r.ok);
  assert.deepEqual(r.team.batters.map((b) => b.bid), ['a', 'f', 'b', 'c']);
  assert.deepEqual(placeFromCard(order(), 2, '7', benchKids), { ok: false, why: 'placed', at: 0 });
  assert.deepEqual(placeFromCard(order(), 0, '44', benchKids), { ok: false, why: 'unknown' });
});

test('card: a new kid goes in at the cursor; done benches whoever was not on the card', () => {
  const t = placeBatter(order(), 1, { bid: 'n', num: '44', name: 'New Kid' }, 'C');
  assert.deepEqual(t.batters.map((b) => b.bid), ['a', 'n', 'b', 'c']);
  assert.equal(t.positions.C, 'n');
  const done = benchFrom(t, 2);
  assert.deepEqual(done.batters.map((b) => b.bid), ['a', 'n']);
  assert.deepEqual(done.positions, { SS: 'a', C: 'n' });
});
