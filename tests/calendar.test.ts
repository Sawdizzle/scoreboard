import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answersFor, byDay, calendarItems, headCount } from '../lib/calendar.ts';
import type { Game, TeamEvent } from '../lib/types.ts';

const now = Date.parse('2026-10-27T12:00:00Z');
const game = (id: string, at: string | null) => ({ id, starts_at: at, is_home: true, opponent_name: 'River', venue: 'Field 3', status: 'scheduled' }) as Game;
const ev = (id: string, at: string) => ({ id, starts_at: at, ends_at: null, kind: 'practice', title: 'Practice', location: null, address: null, canceled: false }) as TeamEvent;

test('games and events in one list, soonest first; untimed and long-past games left out', () => {
  const items = calendarItems([game('g1', '2026-10-29T17:00:00Z'), game('g2', null), game('g0', '2026-10-01T17:00:00Z')],
    [ev('e1', '2026-10-28T23:00:00Z')], now);
  assert.deepEqual(items.map((i) => i.key), ['e-e1', 'g-g1']);
  assert.equal(items[1].title, 'vs River');
});

test('answers and the head count for one item', () => {
  const [item] = calendarItems([game('g1', '2026-10-29T17:00:00Z')], [], now);
  const a = answersFor(item, [
    { game_id: 'g1', event_id: null, player_id: 'p1', status: 'yes', note: null },
    { game_id: 'g1', event_id: null, player_id: 'p2', status: 'no', note: null },
    { game_id: null, event_id: 'g1', player_id: 'p3', status: 'yes', note: null },
  ]);
  assert.deepEqual(a, { p1: 'yes', p2: 'no' });
  assert.deepEqual(headCount(a, 12), { yes: 1, maybe: 0, no: 1, none: 10 });
});

test('a late practice stays on its own local day', () => {
  const items = calendarItems([], [ev('a', '2026-10-28T23:30:00Z'), ev('b', '2026-10-29T01:00:00Z'), ev('c', '2026-10-29T15:00:00Z')], now);
  assert.deepEqual(byDay(items, 'America/Chicago').map((d) => [d.day, d.items.length]), [['2026-10-28', 2], ['2026-10-29', 1]]);
});
