// "Ask your stats": the data Claude gets, rates worked out here, and the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAsk, statsContext } from '../lib/ask.ts';
import type { SeasonLine } from '../lib/stats.ts';
import type { Player } from '../lib/types.ts';

const player = (id: string, first: string, last: string, number: string) => ({ id, first_name: first, last_name: last, number } as Player);
const zero = Object.fromEntries(['b_g', 'b_pa', 'b_ab', 'b_h', 'b_2b', 'b_3b', 'b_hr', 'b_rbi', 'b_r', 'b_bb', 'b_so', 'b_kl', 'b_hbp', 'b_sac', 'b_sf', 'b_roe', 'b_fc', 'b_sb', 'b_cs',
  'p_g', 'p_gs', 'p_outs', 'p_bf', 'p_pitches', 'p_w', 'p_l', 'p_sv', 'p_h', 'p_r', 'p_er', 'p_bb', 'p_so', 'p_hbp', 'p_wp', 'p_bk'].map((k) => [k, 0]));
const line = (id: string, o: Record<string, number>) => ({ ...zero, player_id: id, season_id: 's', imported_at: null, ...o } as SeasonLine);

test('the context: names, counting stats without zeros, rates as the app shows them, games and per-game lines', () => {
  const c = statsContext({
    season: 'Fall 2026', gameInnings: 6,
    players: [player('a', 'Ava', 'Reyes', '7'), player('b', 'Ben', 'Ortiz', '12')],
    lines: [line('a', { b_g: 5, b_pa: 12, b_ab: 10, b_h: 4, b_2b: 1, b_bb: 2 }), line('b', { p_g: 2, p_outs: 20, p_bf: 30, p_er: 3, p_so: 9, p_bb: 4, p_h: 5 }), line('gone', { b_pa: 3 })],
    games: [{ id: 'g1', starts_at: '2026-10-17T14:45:00Z', opponent_name: 'Express', is_home: false, status: 'final', live: { home_score: 3, away_score: 5 }, counts_for_stats: true },
      { id: 'g2', starts_at: null, opponent_name: 'Later', is_home: true, status: 'scheduled', live: null, counts_for_stats: true }],
    gameLines: [{ game_id: 'g1', player_id: 'a', b_pa: 1, b_ab: 1, b_h: 1, b_2b: 0, b_3b: 0, b_hr: 0, b_rbi: 2, b_r: 0, b_bb: 0, b_so: 0, b_sb: 0, p_outs: 0, p_so: 0, p_r: 0, p_er: 0, p_bb: 0, p_h: 0, p_pitches: 0 }],
  });
  assert.deepEqual(c.players[0], { player: 'Ava Reyes #7', batting: { G: 5, PA: 12, AB: 10, H: 4, '2B': 1, BB: 2, AVG: '.400', OBP: '.500', SLG: '.500', OPS: '1.000' }, pitching: null });
  assert.deepEqual(c.players[1].pitching, { IP: '6.2', G: 2, BF: 30, H: 5, ER: 3, BB: 4, SO: 9, ERA: '2.70', WHIP: '1.35' });
  assert.equal(c.players.length, 2);
  assert.deepEqual(c.games, [{ date: '2026-10-17', opponent: 'Express', result: 'W', score: '5-3', counts: true, lines: { 'Ava Reyes #7': { PA: 1, AB: 1, H: 1, RBI: 2 } } }]);
});

test('the check: an answer, and a table whose rows fit its columns', () => {
  assert.deepEqual(checkAsk({ answer: 'Ava.', columns: ['Player', 'OBP'], rows: [['Ava', '.500']], basis: 'season' }), []);
  assert.deepEqual(checkAsk({ answer: ' ', columns: ['Player', 'OBP'], rows: [['Ava']], basis: '' }), ['The answer was empty.', 'Every table row needs one cell per column.']);
});
