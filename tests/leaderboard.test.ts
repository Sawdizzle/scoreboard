import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boards } from '../lib/leaderboard.ts';
import type { SeasonLine } from '../lib/stats.ts';

const zero: Omit<SeasonLine, 'player_id'> = {
  season_id: 's', imported_at: null, b_g: 0, b_pa: 0, b_ab: 0, b_h: 0, b_2b: 0, b_3b: 0, b_hr: 0, b_rbi: 0, b_r: 0, b_bb: 0, b_so: 0, b_kl: 0, b_hbp: 0, b_sac: 0,
  b_sf: 0, b_roe: 0, b_fc: 0, b_sb: 0, b_cs: 0, p_g: 0, p_gs: 0, p_outs: 0, p_bf: 0, p_pitches: 0, p_w: 0, p_l: 0, p_sv: 0, p_h: 0, p_r: 0, p_er: 0, p_bb: 0,
  p_so: 0, p_hbp: 0, p_wp: 0, p_bk: 0,
};
const line = (id: string, l: Partial<SeasonLine>): SeasonLine => ({ ...zero, player_id: id, ...l });

test('rates count only players who qualify; counts take everyone', () => {
  const lines = [
    line('a', { b_g: 7, b_pa: 10, b_ab: 8, b_h: 4, b_so: 1 }),
    line('b', { b_g: 7, b_pa: 9, b_ab: 9, b_h: 1, b_so: 5 }),
    line('c', { b_g: 2, b_pa: 2, b_ab: 1, b_h: 1, b_so: 0 }), // 1.000 on one at-bat: not a leader
  ];
  const { leaders, work, minPa } = boards(lines);
  assert.equal(minPa, 7);
  const avg = leaders.find((b) => b.key === 'avg')!;
  assert.deepEqual(avg.rows.map((r) => r.s.player_id), ['a', 'b']);
  assert.equal(avg.rows[0].text, '.500');
  assert.deepEqual(leaders.find((b) => b.key === 'h')!.rows.map((r) => r.s.player_id), ['a', 'b', 'c']);
  assert.equal(work.find((b) => b.key === 'so')!.rows[0].s.player_id, 'b');
  assert.equal(work.find((b) => b.key === 'avgLow')!.rows[0].s.player_id, 'b');
});

test('ERA ranks low first among those with two innings; the other end high first', () => {
  const lines = [
    line('p1', { p_outs: 12, p_er: 2, p_so: 6, p_bb: 1 }),
    line('p2', { p_outs: 9, p_er: 6, p_so: 2, p_bb: 5 }),
    line('p3', { p_outs: 3, p_er: 0, p_so: 3 }), // one inning: no ERA leader
  ];
  const { leaders, work } = boards(lines, 7);
  assert.deepEqual(leaders.find((b) => b.key === 'era')!.rows.map((r) => r.s.player_id), ['p1', 'p2']);
  assert.equal(work.find((b) => b.key === 'eraHigh')!.rows[0].s.player_id, 'p2');
  assert.equal(work.find((b) => b.key === 'pbb')!.rows[0].s.player_id, 'p2');
  assert.equal(leaders.find((b) => b.key === 'ip')!.rows[0].text, '4.0');
});

test('a category nobody has is left out', () => {
  const { leaders } = boards([line('a', { b_g: 1, b_pa: 3, b_ab: 3 })]);
  assert.equal(leaders.find((b) => b.key === 'sb'), undefined);
});
