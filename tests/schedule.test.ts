import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSchedule } from '../lib/schedule.ts';
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
