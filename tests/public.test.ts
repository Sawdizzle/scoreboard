// The public box score and play list, from public_game()'s shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxLines, plays, result, type PublicGame } from '../lib/public.ts';

const t = { slug: 's', name: 'S', display_name: 'S', color: '#111111', color2: '#222222', logo_url: null, age_group: null };
const game: PublicGame = {
  v: '1', team: t, opponent: { ...t, slug: null }, season: null,
  game: { id: 'g', is_home: true, status: 'live', seq: 4, live: {}, starts_at: null, venue: null, counts_for_stats: true },
  lineups: {
    us: { batters: [{ bid: 'a1', num: '7', name: 'Johnny Vance' }, { bid: 'a2', num: '3', name: '' }], positions: { P: 'a2' } },
    them: { batters: [{ bid: 'x1', num: '19', name: '' }], positions: { P: 'x1' } },
  },
  tonight: [
    { side: 'us', bid: 'a1', b_pa: 2, b_ab: 2, b_h: 1, b_rbi: 2, b_r: 1 },
    { side: 'us', bid: 'gone', b_pa: 1, b_ab: 1, b_so: 1 },
    { side: 'us', bid: 'a2', p_outs: 7, p_bf: 9, p_pitches: 31, p_so: 3, p_h: 2 },
    { side: 'them', bid: 'x1', b_pa: 1, b_bb: 1, p_pitches: 12 },
  ],
  pas: [{ side: 'them', bid: 'x1', inning: 1, kind: 'BB', code: null, rbi: 0 }, { side: 'us', bid: 'a1', inning: 1, kind: 'H2', code: '', rbi: 2 }],
};

test('a side\'s box: batting order first, then a hitter who has left it; pitchers apart', () => {
  const us = boxLines(game, 'us');
  assert.deepEqual(us.batting, [
    { key: 'a1', num: '7', name: 'Johnny Vance', cells: ['2', '1', '1', '2', '0', '0'] },
    { key: 'a2', num: '3', name: 'No. 3', cells: ['0', '0', '0', '0', '0', '0'] },
    { key: 'gone', num: '', name: 'Substitute', cells: ['1', '0', '0', '0', '0', '1'] }]);
  assert.deepEqual(us.pitching, [{ key: 'a2', num: '3', name: 'No. 3', cells: ['2.1', '2', '0', '0', '0', '3', '31'] }]);
  assert.deepEqual(boxLines(game, 'them').batting[0].name, 'No. 19');
});

test('plays read newest first, with the RBI', () => {
  assert.deepEqual(plays(game).map((p) => [p.inning, p.who, p.what]), [['1st', 'Johnny Vance', 'Double, 2 RBI'], ['1st', 'No. 19', 'Walk']]);
});

test('a result is from the page\'s own side, and only once final', () => {
  assert.equal(result({ is_home: true, status: 'live', live: { home_score: 5, away_score: 3 } }), null);
  assert.equal(result({ is_home: true, status: 'final', live: { home_score: 5, away_score: 3 } }), 'W 5-3');
  assert.equal(result({ is_home: false, status: 'final', live: { home_score: 5, away_score: 3 } }), 'L 3-5');
  assert.equal(result({ is_home: false, status: 'final', live: {} }), 'T 0-0');
});
