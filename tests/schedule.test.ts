import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameDay, splitSchedule } from '../lib/schedule.ts';
import type { Game } from '../lib/types.ts';

const G = (id: string, status: Game['status'], starts_at: string | null) => ({ id, status, starts_at }) as Game;
const ids = (gs: Game[]) => gs.map((g) => g.id);

test('final games move to completed, most recent first', () => {
  // listGames order: soonest first, no time last.
  const games = [
    G('sep1', 'final', '2026-09-01T23:00:00Z'), G('sep20', 'final', '2026-09-20T23:00:00Z'),
    G('oct3', 'live', '2026-10-03T23:00:00Z'), G('oct10', 'scheduled', '2026-10-10T23:00:00Z'),
    G('tbd', 'scheduled', null), G('old', 'final', null),
  ];
  const { upcoming, completed } = splitSchedule(games);
  assert.deepEqual(ids(upcoming), ['oct3', 'oct10', 'tbd']);
  assert.deepEqual(ids(completed), ['sep20', 'sep1', 'old']);
});

test('no games, or none final', () => {
  assert.deepEqual(splitSchedule([]), { upcoming: [], completed: [] });
  const { upcoming, completed } = splitSchedule([G('a', 'scheduled', '2026-10-10T23:00:00Z')]);
  assert.deepEqual(ids(upcoming), ['a']);
  assert.deepEqual(completed, []);
});

test('game day: live first, then the next day\'s games; a stale live game goes last', () => {
  const now = Date.parse('2026-10-19T14:00:00Z');
  const D = (id: string, starts_at: string | null, status: Game['status'] = 'scheduled') => ({ id, starts_at, status }) as Game;
  const games = [
    D('old', '2026-10-18T15:00:00Z', 'live'),
    D('done', '2026-10-19T09:00:00Z', 'final'),
    D('g1', '2026-10-19T15:00:00Z'), D('g2', '2026-10-19T18:15:00Z'),
    D('next-week', '2026-10-26T22:45:00Z'),
  ];
  assert.deepEqual(gameDay(games, now).map((x) => [x.game.id, x.stale]), [['g1', false], ['g2', false], ['old', true]]);
  const playing = [D('now', '2026-10-19T13:00:00Z', 'live'), ...games.slice(2)];
  assert.deepEqual(gameDay(playing, now).map((x) => x.game.id), ['now', 'g1', 'g2']);
  assert.deepEqual(gameDay([], now), []);
});
