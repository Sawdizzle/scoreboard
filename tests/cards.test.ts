// End-of-season cards: public names, the numbers they are written from, the check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardData, checkCards } from '../lib/cards.ts';
import type { SeasonLine } from '../lib/stats.ts';
import type { Player } from '../lib/types.ts';

const zero = Object.fromEntries(['b_g', 'b_pa', 'b_ab', 'b_h', 'b_2b', 'b_3b', 'b_hr', 'b_rbi', 'b_r', 'b_bb', 'b_so', 'b_kl', 'b_hbp', 'b_sac', 'b_sf', 'b_roe', 'b_fc', 'b_sb', 'b_cs',
  'p_g', 'p_gs', 'p_outs', 'p_bf', 'p_pitches', 'p_w', 'p_l', 'p_sv', 'p_h', 'p_r', 'p_er', 'p_bb', 'p_so', 'p_hbp', 'p_wp', 'p_bk'].map((k) => [k, 0]));
const p = (id: string, first: string, last: string, number: string, public_name: Player['public_name'], active = true) => ({ id, first_name: first, last_name: last, number, public_name, active } as Player);
const players = [p('a', 'Ava', 'Reyes', '7', 'full'), p('b', 'Ben', 'Ortiz', '12', 'number'), p('c', 'Cy', 'Park', '3', 'first_initial'), p('d', 'Old', 'Player', '9', 'full', false)];
const lines = [{ ...zero, player_id: 'a', season_id: 's', imported_at: null, b_g: 10, b_pa: 30, b_ab: 25, b_h: 9, b_bb: 4, b_sb: 6 } as SeasonLine];
const data = cardData({ players, lines, fmt: 'full', gameInnings: 6 });

test('names as the public sees them; inactive players with no season left out', () => {
  assert.deepEqual(data.map((x) => x.name), ['Ava Reyes', 'No. 12', 'Cy P.']);
  assert.deepEqual(data[0].batting, { G: 10, PA: 30, H: 9, '2B': 0, '3B': 0, HR: 0, R: 0, RBI: 0, BB: 4, SB: 6, AVG: '.360', OBP: '.448' });
  assert.equal(data[1].batting, null);
});

test('the check: one card each, and only each player’s own numbers', () => {
  const card = (key: string, body: string) => ({ key, headline: 'A great season', body, highlights: [] as string[] });
  assert.deepEqual(checkCards({ cards: [card('p1', 'Hit .360 with 9 hits and 6 steals in Fall 2026.'), card('p2', 'No. 12 was there every game.'), card('p3', 'Two big catches.')] }, data, ['Fall 2026']), []);
  assert.deepEqual(checkCards({ cards: [card('p1', 'Hit .400 with 9 hits.'), card('p2', 'Great.')] }, data), [
    'Cy P. has no card.', "Ava Reyes's card uses .400, not in their numbers."]);
});
