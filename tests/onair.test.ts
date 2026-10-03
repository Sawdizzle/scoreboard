// What the stream says about the batter, the pitcher and who is due up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airView, boxScore, breakText, layoutOf, qrLayer, bugAnim, bugState, feedView, leaders, momentText, ordinal, paText, type AirCtx, type Feed } from '../lib/onair.ts';
import { engineGame } from '../lib/scoring.ts';
import type { SeasonLine } from '../lib/stats.ts';
import type { Lineup } from '../lib/types.ts';

const team = (p: string): Lineup => ({
  batters: Array.from({ length: 9 }, (_, i) => ({ bid: `${p}${i + 1}`, num: String(i + 1), name: `${p.toUpperCase()} Player${i + 1}` })),
  positions: { P: `${p}9`, SS: `${p}2` },
});
const line = (id: string, over: Partial<SeasonLine>): SeasonLine => ({
  player_id: id, season_id: 's', imported_at: null,
  b_g: 0, b_pa: 0, b_ab: 0, b_h: 0, b_2b: 0, b_3b: 0, b_hr: 0, b_rbi: 0, b_r: 0, b_bb: 0, b_so: 0, b_kl: 0, b_hbp: 0, b_sac: 0, b_sf: 0, b_roe: 0, b_fc: 0, b_sb: 0, b_cs: 0,
  p_g: 0, p_gs: 0, p_outs: 0, p_bf: 0, p_pitches: 0, p_w: 0, p_l: 0, p_sv: 0, p_h: 0, p_r: 0, p_er: 0, p_bb: 0, p_so: 0, p_hbp: 0, p_wp: 0, p_bk: 0, ...over,
});
// Us at home, batting in the bottom of the 5th, our 2nd hitter up, their h9 pitching.
const live = { inning: 5, half: 'bottom', balls: 2, strikes: 1, outs: 1, home_score: 2, away_score: 4, state: { batIdx: { home: 1, away: 7 }, pitches: { away: 58 } } };
const g = () => engineGame({ is_home: true, live, status: 'live' }, { us: team('a'), them: team('h') }, 7);
const ctx: AirCtx = {
  tonight: { a2: { b_pa: 2, b_ab: 1, b_bb: 1 }, h9: { p_outs: 13, p_r: 2, p_so: 4, p_pitches: 57 } },
  season: { a2: line('a2', { b_g: 11, b_pa: 40, b_ab: 33, b_h: 9, b_hr: 1, b_rbi: 7, b_bb: 6, b_hbp: 1, b_sb: 4 }) },
  pas: [{ side: 'us', bid: 'a2', inning: 1, kind: 'BB', code: null }, { side: 'them', bid: 'h1', inning: 1, kind: 'K', code: null }, { side: 'us', bid: 'a2', inning: 3, kind: 'FB', code: 'F8' }],
  gameInnings: 7,
};

test('the batter: season average, tonight, the card cells and each time up', () => {
  const { batter, batSide, fieldSide } = airView(g(), ctx);
  assert.equal(batSide, 'home');
  assert.equal(fieldSide, 'away');
  assert.deepEqual(batter, {
    bid: 'a2', num: '2', name: 'A Player2', pos: 'SS', avg: '.273', today: '0-1, BB', games: 11,
    cells: [{ v: '.400', k: 'OBP' }, { v: '1', k: 'HR' }, { v: '7', k: 'RBI' }, { v: '4', k: 'SB' }],
    pas: [{ inn: '1st', what: 'Walk' }, { inn: '3rd', what: 'Flyout F8' }],
  });
});

test('a player with no season behind him shows tonight only', () => {
  const v = airView(g(), { ...ctx, season: {} });
  assert.equal(v.batter?.avg, null);
  assert.deepEqual(v.batter?.cells, []);
  assert.equal(v.batter?.today, '0-1, BB');
});

test('the pitcher: the rules\' pitch count on the bug, his own line on the card', () => {
  const { pitcher } = airView(g(), ctx);
  assert.equal(pitcher?.last, 'Player9');
  assert.equal(pitcher?.pitches, 58);
  assert.deepEqual(pitcher?.today, [{ v: '4.1', k: 'IP' }, { v: '2', k: 'R' }, { v: '4', k: 'K' }, { v: '57', k: 'P' }]);
  assert.equal(pitcher?.season, null);
  const s = airView(g(), { ...ctx, season: { h9: line('h9', { p_outs: 42, p_bf: 60, p_er: 4, p_h: 10, p_bb: 6, p_so: 27 }) } }).pitcher?.season;
  assert.deepEqual(s, [{ v: '2.00', k: 'ERA' }, { v: '27', k: 'K' }, { v: '1.14', k: 'WHIP' }]);
});

test('due up is the hitter at the plate and the two behind him, around the order', () => {
  assert.deepEqual(airView(g(), ctx).dueUp.map((b) => b.bid), ['a2', 'a3', 'a4']);
  const top = engineGame({ is_home: true, live: { ...live, half: 'top' }, status: 'live' }, { us: team('a'), them: team('h') }, 7);
  assert.deepEqual(airView(top, ctx).dueUp.map((b) => b.bid), ['h8', 'h9', 'h1']);
});

test('no lineup: no batter, no pitcher, nothing due up, and no crash', () => {
  const bare = engineGame({ is_home: true, live, status: 'live' }, {}, 7);
  assert.deepEqual(airView(bare, ctx), { batSide: 'home', fieldSide: 'away', batter: null, pitcher: null, dueUp: [], order: [], defense: [] });
});

test('a number-only player goes by his number', () => {
  const us = team('a');
  us.batters[1].name = '';
  const v = airView(engineGame({ is_home: true, live, status: 'live' }, { us, them: team('h') }, 7), ctx);
  assert.equal(v.batter?.name, '#2');
});

test('the feed turns into the same view; no game, no view', () => {
  const feed = {
    v: '1', show_line: true, auto_card: false, card: null, season: { name: 'Fall', game_innings: 7 },
    team: { name: 'A', display_name: 'A', color: '#111111', color2: '#222222', logo_url: null, age_group: null },
    opponent: { name: 'H', display_name: 'H', color: '#333333', color2: '#444444', logo_url: null, age_group: null },
    game: { id: 'g', is_home: true, status: 'live', seq: 3, live }, lineups: { us: team('a'), them: null },
    tonight: [{ side: 'us', bid: 'a2', b_pa: 2, b_ab: 1, b_bb: 1 }], pas: ctx.pas, season_stats: [ctx.season.a2],
  } as Feed;
  const v = feedView(feed)!;
  assert.equal(v.air.batter?.avg, '.273');
  assert.equal(v.air.pitcher, null);
  assert.equal(feedView({ ...feed, game: null }), null);
});

test('inning names and play names', () => {
  assert.deepEqual([1, 2, 3, 4, 11].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th']);
  assert.equal(paText({ kind: 'K', code: null }), 'Strikeout');
  assert.equal(paText({ kind: 'H2', code: '' }), 'Double');
  assert.equal(paText({ kind: 'GB', code: '6-3' }), 'Groundout 6-3');
});

test('team leaders: the best of ours in each column, with at-bats behind an average', () => {
  const roster = [{ id: 'a1', num: '1', name: 'Al One' }, { id: 'a2', num: '2', name: '' }, { id: 'a3', num: '3', name: 'Cy Three' }];
  const lines = [
    line('a1', { b_pa: 3, b_ab: 2, b_h: 2, b_rbi: 1 }),             // 1.000, but two at-bats
    line('a2', { b_pa: 40, b_ab: 33, b_h: 9, b_hr: 1, b_rbi: 7, b_sb: 4 }),
    line('a3', { b_pa: 40, b_ab: 36, b_h: 13, b_rbi: 6, b_sb: 9 }),
    line('zz', { b_pa: 50, b_ab: 40, b_h: 30, b_hr: 9, b_rbi: 40, b_sb: 20 }), // not on our roster
  ];
  assert.deepEqual(leaders(lines, roster), [
    { k: 'AVG', v: '.361', num: '3', name: 'Cy Three' }, { k: 'HR', v: '1', num: '2', name: '#2' },
    { k: 'RBI', v: '7', num: '2', name: '#2' }, { k: 'SB', v: '9', num: '3', name: 'Cy Three' }]);
  assert.deepEqual(leaders([], roster), []);
});

test('the box score: runs by inning, blank for halves not yet played', () => {
  const game = engineGame({ is_home: true, status: 'live', live: { ...live, home_hits: 4, away_hits: 6, away_errors: 1,
    line_score: [{ top: 1, bottom: 0 }, { top: 0, bottom: 2 }, { top: 3, bottom: 0 }, { top: 0, bottom: 0 }, { top: 0, bottom: 0 }] } }, {}, 7);
  assert.deepEqual(boxScore(game, 7), {
    innings: [1, 2, 3, 4, 5, 6, 7], away: ['1', '0', '3', '0', '0', '', ''], home: ['0', '2', '0', '0', '0', '', ''],
    awayTot: ['4', '6', '1'], homeTot: ['2', '4', '0'] });
  const top = engineGame({ is_home: true, status: 'live', live: { ...live, half: 'top', line_score: [] } }, {}, 7);
  assert.deepEqual([boxScore(top, 7).away[4], boxScore(top, 7).home[4]], ['0', '']);
});

test('an animated bug gets the game in its own shape, and a stinger for the big plays', () => {
  const feed = {
    team: { name: 'Blue Steel Baseball', display_name: 'Blue Steel', abbr: 'STEEL', color: '#111111', color2: '#222222', logo_url: null, age_group: null },
    opponent: { name: 'Hawks', display_name: 'Hawks', color: '#333333', color2: '#444444', logo_url: null, age_group: null },
    game: { id: 'g', is_home: true, status: 'live', seq: 3, live },
  } as unknown as Feed;
  const s = bugState(feed, g(), airView(g(), ctx));
  assert.deepEqual([s.away.abbr, s.away.r, s.home.abbr, s.home.r, s.home.name], ['HAWKS', 4, 'STEEL', 2, 'Blue Steel']);
  assert.deepEqual([s.inning, s.half, s.balls, s.strikes, s.outs, s.batter, s.pitcher, s.pitchCount], [5, 'bot', 2, 1, 1, 'A Player2', 'H Player9', 58]);
  assert.equal(bugState({ ...feed, show_line: true } as Feed, g(), airView(g(), ctx)).batter, 'A Player2 · .273');
  assert.deepEqual(bugAnim({ seq: 1, type: 'homerun', kind: 'HR' }), { type: 'homerun', meta: {} });
  assert.deepEqual(bugAnim({ seq: 1, type: 'strikeout', kind: 'KL' }), { type: 'strikeoutlooking', meta: {} });
  assert.deepEqual(bugAnim({ seq: 1, type: 'play', kind: 'H2' }), { type: 'play', meta: { text: 'Double' } });
  assert.equal(bugAnim({ seq: 1, type: 'ball', kind: null }), null);
  assert.equal(bugAnim(null), null);
});

test('the whole order and the defense, for the lineup and defense cards', () => {
  const v = airView(g(), ctx);
  assert.equal(v.order.length, 9);
  assert.deepEqual(v.order[1].bid, 'a2');
  assert.deepEqual(v.defense, [{ pos: 'P', num: '9', name: 'H Player9' }, { pos: 'SS', num: '2', name: 'H Player2' }]);
});

test('moments and the break between halves', () => {
  assert.equal(momentText({ seq: 1, type: 'homerun', kind: 'HR' }), 'Home run');
  assert.equal(momentText({ seq: 1, type: 'strikeout', kind: 'KL' }), 'Strikeout looking');
  assert.equal(momentText({ seq: 1, type: 'play', kind: 'H3' }), 'Triple');
  assert.equal(momentText({ seq: 1, type: 'play', kind: 'GB' }), null);
  assert.equal(breakText(g()), 'Middle of the 5th');
  assert.equal(breakText(engineGame({ is_home: true, live: { inning: 6, half: 'top' }, status: 'live' }, {}, 7)), 'End of the 5th');
});

test('the QR layer: stored values are clamped, and anything odd falls back', () => {
  assert.deepEqual(qrLayer(null), { on: false, size: 10, pos: 'tr', opacity: 1 });
  assert.deepEqual(qrLayer({ on: true, size: 500, pos: 'br', opacity: 0 }), { on: true, size: 40, pos: 'br', opacity: 0.2 });
  assert.deepEqual(qrLayer({ on: 'yes', size: 'big', pos: 'middle' } as never), { on: false, size: 10, pos: 'tr', opacity: 1 });
  assert.deepEqual(layoutOf(null), { bug: { scale: 0.6, pos: 'bl' }, cards: { scale: 0.75 } });
  assert.deepEqual(layoutOf({ bug: { scale: 9, pos: 'tr' }, cards: { scale: 0 } }), { bug: { scale: 1.2, pos: 'tr' }, cards: { scale: 0.4 } });
  assert.deepEqual(layoutOf({ bug: { pos: 'mm' as never } }).bug, { scale: 0.6, pos: 'bl' });
});
