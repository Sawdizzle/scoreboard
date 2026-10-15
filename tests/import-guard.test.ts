import { test } from 'node:test';
import assert from 'node:assert/strict';
import { padGamesBlock, padGamesBySeason, padGamesWhy, type PadGame } from '../lib/gamechanger.ts';

// A season the pad has scored games in takes no GameChanger import: the
// export's totals already hold those games, and season_stats adds the pad's
// on top. Names are made up.
const game = (id: string, season_id: string, opponent_name: string, is_home = true): PadGame =>
  ({ id, season_id, opponent_name, is_home, starts_at: '2026-10-17T17:00:00Z' });

test('a season with no pad-scored games is open to an import', () => {
  assert.equal(padGamesBlock([]), null);
  assert.deepEqual(padGamesBySeason([]), {});
});

test('one pad-scored game closes the season, and is named', () => {
  const msg = padGamesBlock([game('g1', 'fall', 'Hawks')]);
  assert.ok(msg);
  assert.match(msg, /^1 game in this season was scored in Scoreboard \(vs Hawks\)\./);
  assert.match(msg, /already include it, so importing would count that game twice/);
});

test('several are counted and named, home and away', () => {
  const msg = padGamesBlock([game('g1', 'fall', 'Hawks'), game('g2', 'fall', 'Wolves', false)]);
  assert.match(msg ?? '', /^2 games in this season were scored in Scoreboard \(vs Hawks, at Wolves\)\./);
  assert.match(padGamesWhy(2), /already include them, so importing would count those games twice/);
});

test('games are grouped by their own season, so another season stays open', () => {
  const by = padGamesBySeason([game('g1', 'fall', 'Hawks'), game('g2', 'spring', 'Owls'), game('g3', 'fall', 'Wolves')]);
  assert.deepEqual(by.fall.map((g) => g.id), ['g1', 'g3']);
  assert.deepEqual(by.spring.map((g) => g.id), ['g2']);
  assert.equal(padGamesBlock(by.summer ?? []), null);
});
