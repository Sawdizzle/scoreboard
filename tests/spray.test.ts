import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sprayBalls, sprayCounts, sprayLabel, sprayPlaces, tappedSpot, type SprayBall, type SprayEvent, type SprayStat } from '../lib/spray.ts';

// A play the pad recorded: its kind, how it was hit, and where, if anywhere.
const E = (id: number, kind: string, bb?: string, loc?: unknown, type = 'play', season_id: string | null = 's1'): SprayEvent =>
  ({ id, type, season_id, payload: { play: { kind }, inputs: { kind, ...(bb ? { bb } : {}), ...(loc !== undefined ? { loc } : {}) } } });
// The batter's plate appearance on that play.
const PA = (event_id: number, bid = 'p7', side: 'us' | 'them' = 'us'): SprayStat => ({ event_id, side, bid, b_pa: 1 });

test('spray: the batter’s balls in play, oldest first, each with what came of it', () => {
  const events = [
    E(5, 'GB', 'GB', { x: 36, y: 46 }), E(2, 'H1', 'LD', { x: 17, y: 21 }), E(3, 'E', 'HGB', { x: 25, y: 64 }),
    E(4, 'FC', 'BUNT', { x: 50, y: 80 }), E(6, 'DP', 'GB', { x: 34, y: 44 }), E(7, 'SF', 'FB', { x: 20, y: 18 }),
  ];
  const balls = sprayBalls(events, [2, 3, 4, 5, 6, 7].map((id) => PA(id)), 'p7');
  assert.deepEqual(balls.map((b) => [b.event_id, b.kind, b.result]), [
    [2, 'H1', 'hit'], [3, 'E', 'reached'], [4, 'FC', 'reached'], [5, 'GB', 'out'], [6, 'DP', 'out'], [7, 'SF', 'out'],
  ]);
  assert.deepEqual(balls[0], { event_id: 2, season_id: 's1', kind: 'H1', bb: 'LD', result: 'hit', at: { x: 17, y: 21 } });
});

test('spray: only our batter’s own plate appearances, never a runner or the other side', () => {
  const events = [E(1, 'H2', 'LD', { x: 10, y: 30 }), E(2, 'FB', 'FB', { x: 52, y: 14 }), E(3, 'GB', 'GB', { x: 40, y: 50 }), E(4, 'H1', 'GB', { x: 30, y: 40 })];
  const stats: SprayStat[] = [
    PA(1),
    // Someone else's at-bat, with our batter scoring from second on it.
    PA(2, 'p3'), { event_id: 2, side: 'us', bid: 'p7', b_r: 1 } as SprayStat,
    // Their batter, whose id happens to match.
    PA(3, 'p7', 'them'),
    // A row with no plate appearance on it.
    { event_id: 4, side: 'us', bid: 'p7', b_pa: 0 },
  ];
  assert.deepEqual(sprayBalls(events, stats, 'p7').map((b) => b.event_id), [1]);
});

test('spray: a walk, a strikeout and a dropped third strike put nothing in play', () => {
  const events: SprayEvent[] = [
    { id: 1, type: 'walk', season_id: 's1', payload: {} },
    { id: 2, type: 'strikeout', season_id: 's1', payload: { play: { kind: 'K' } } },
    E(3, 'K3', undefined, { x: 50, y: 88 }),
    { id: 4, type: 'runner', season_id: 's1', payload: { play: { kind: 'SB' } } },
  ];
  assert.deepEqual(sprayBalls(events, [1, 2, 3, 4].map((id) => PA(id)), 'p7'), []);
});

test('spray: a ball in play with no spot is kept, with nowhere to draw it', () => {
  const events: SprayEvent[] = [
    // A home run from the key, an older single with only its type, a hit whose spot was skipped.
    { id: 1, type: 'homerun', season_id: 's1', payload: { runs: 2 } as SprayEvent['payload'] },
    { id: 2, type: 'hit', season_id: 's1', payload: { reached: 1 } },
    E(3, 'H1', 'LD'),
    // Spots the rules would not have kept.
    E(4, 'GB', 'GB', { x: '40', y: 50 }), E(5, 'GB', 'GB', { x: null, y: null }), E(6, 'FB', 'FB', null),
  ];
  const balls = sprayBalls(events, [1, 2, 3, 4, 5, 6].map((id) => PA(id)), 'p7');
  assert.deepEqual(balls.map((b) => [b.kind, b.at]), [['HR', null], ['H1', null], ['H1', null], ['GB', null], ['GB', null], ['FB', null]]);
  assert.deepEqual(sprayCounts(balls), { hit: 0, out: 0, reached: 0, unspotted: 6 });
});

test('spray: a spot is whole numbers inside the box', () => {
  const balls = sprayBalls([E(1, 'H1', 'LD', { x: 33.6, y: -4 }), E(2, 'FB', 'FB', { x: 104, y: 12.2 })], [PA(1), PA(2)], 'p7');
  assert.deepEqual(balls.map((b) => b.at), [{ x: 34, y: 0 }, { x: 100, y: 12 }]);
});

test('spray: each play once, with the season of its game', () => {
  const events = [E(1, 'H1', 'LD', { x: 17, y: 21 }, 'play', 's1'), E(1, 'H1', 'LD', { x: 17, y: 21 }, 'play', 's1'), E(2, 'GB', 'GB', { x: 40, y: 50 }, 'play', 's2')];
  const balls = sprayBalls(events, [PA(1), PA(2)], 'p7');
  assert.deepEqual(balls.map((b) => [b.event_id, b.season_id]), [[1, 's1'], [2, 's2']]);
});

test('spray: the key counts what is drawn, and what is not', () => {
  const ball = (result: SprayBall['result'], at: SprayBall['at']): SprayBall => ({ event_id: 1, season_id: 's1', kind: 'GB', bb: null, result, at });
  const spot = { x: 50, y: 50 };
  assert.deepEqual(sprayCounts([ball('hit', spot), ball('hit', spot), ball('out', spot), ball('reached', spot), ball('hit', null), ball('out', null)]),
    { hit: 2, out: 1, reached: 1, unspotted: 2 });
});

test('spray: a mark’s label is the play and how it was hit', () => {
  const ball = (kind: string, bb: string | null): SprayBall => ({ event_id: 1, season_id: 's1', kind, bb, result: 'hit', at: null });
  assert.equal(sprayLabel(ball('H1', 'LD')), 'Single · line drive');
  assert.equal(sprayLabel(ball('GB', 'HGB')), 'Groundout · hard grounder');
  assert.equal(sprayLabel(ball('FB', 'FB')), 'Flyout');
  assert.equal(sprayLabel(ball('HR', null)), 'Home run');
});

test('spray: places stretch across, and balls on one spot ring it rather than hide each other', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  // Eight singles tapped on the left fielder, two balls dragged to the top corner.
  const balls = sprayBalls(ids.map((id) => E(id, 'H1', 'LD', id > 8 ? { x: 100, y: 0 } : { x: 17, y: 21 })), ids.map((id) => PA(id)), 'p7');
  const places = sprayPlaces(balls, 1.4, 4);
  // The first on a spot is on it.
  assert.deepEqual([places[0].x, places[0].y], [23.8, 21]);
  // The next six ring it a gap away, the two after that a ring further out, and no two share a place.
  for (const p of places.slice(1, 7)) assert.ok(Math.abs(Math.hypot(p.x - 23.8, p.y - 21) - 4) < 0.01);
  for (const p of places.slice(7, 8)) assert.ok(Math.abs(Math.hypot(p.x - 23.8, p.y - 21) - 8) < 0.01);
  assert.equal(new Set(places.slice(0, 8).map((p) => `${p.x},${p.y}`)).size, 8);
  // Never off the chart.
  assert.deepEqual([places[8].x, places[8].y], [140, 0]);
  for (const p of places) assert.ok(p.x >= 0 && p.x <= 140 && p.y >= 0 && p.y <= 100);
  // A ball with no spot has no place.
  assert.deepEqual(sprayPlaces(sprayBalls([E(1, 'H1', 'LD')], [PA(1)], 'p7'), 1.4, 4), []);
});

test('spray: a fielder tapped for a fielded ball keeps that fielder’s spot', () => {
  // A 6-3 groundout, a fly out to center, an error on the third baseman, a sac fly to right.
  assert.deepEqual(tappedSpot('GB', 'SS'), { x: 35, y: 43 });
  assert.deepEqual(tappedSpot('FB', 'CF'), { x: 50, y: 11 });
  assert.deepEqual(tappedSpot('E', '3B'), { x: 22, y: 63 });
  assert.deepEqual(tappedSpot('SF', 'RF'), { x: 83, y: 21 });
  // A hit asks where it went, and a dropped third strike was never in play.
  assert.equal(tappedSpot('H1', 'LF'), null);
  assert.equal(tappedSpot('K3', 'C'), null);
  // No fielder, or none the picker stands anywhere.
  assert.equal(tappedSpot('GB', null), null);
  assert.equal(tappedSpot('GB', ''), null);
  assert.equal(tappedSpot('GB', 'DH'), null);
  assert.equal(tappedSpot('GB', 'toString'), null);
});
