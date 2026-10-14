import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inningsToOuts, matchRows, parseCsv, parseGameChanger } from '../lib/gamechanger.ts';
import { batting, innings, pitching, rate2, rate3, type SeasonLine } from '../lib/stats.ts';

// A GameChanger export cut down to the shape that matters: the section row,
// the header row with Batting and Pitching sharing names (H, BB, SO, HBP, R,
// SB, CS), two players, Totals, a blank row and the Glossary. Names are made up.
const B = ['GP', 'PA', 'AB', 'AVG', 'H', '2B', '3B', 'HR', 'RBI', 'R', 'BB', 'SO', 'K-L', 'HBP', 'SAC', 'SF', 'ROE', 'FC', 'SB', 'CS'];
const P = ['IP', 'GP', 'GS', 'BF', '#P', 'W', 'L', 'SV', 'H', 'R', 'ER', 'BB', 'SO', 'HBP', 'ERA', 'BK', 'SB', 'CS', 'WP'];
const F = ['TC', 'E'];
const q = (cells: string[]) => cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(',');
const pad = (n: number) => Array(n).fill('');
const section = ['', '', '', 'Batting', ...pad(B.length - 1), 'Pitching', ...pad(P.length - 1), 'Fielding', ...pad(F.length - 1)];
const header = ['Number', 'Last', 'First', ...B, ...P, ...F];
const player = (num: string, last: string, first: string, b: string[], p: string[]) => [num, last, first, ...b, ...p, '3', '1'];
const FILE = '﻿' + [
  q(section),
  q(header),
  q(player('7', 'Vance', 'Johnny', ['11', '40', '33', '.273', '9', '2', '0', '1', '7', '8', '6', '6', '2', '1', '0', '0', '1', '0', '4', '1'],
    ['9.2', '4', '2', '48', '170', '1', '1', '0', '12', '9', '7', '6', '14', '1', '5.07', '0', '3', '0', '2'])),
  q(player('', 'Park', 'Cy', ['3', '5', '4', '.250', '1', '0', '0', '0', '-', '2', '1', '1', '0', '0', '0', '0', '0', '0', '2', '0'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '-', '', '', '', ''])),
  q(['Totals', '', '', ...pad(header.length - 3)]),
  q(pad(header.length)),
  q(['Glossary', '', '', 'GP=Games played']),
].join('\r\n');

test('reads each section\'s own columns, though the names repeat', () => {
  const { rows, warnings } = parseGameChanger(FILE);
  assert.equal(rows.length, 2);
  assert.deepEqual(warnings, []);
  const [v, p] = rows;
  assert.deepEqual([v.number, v.first_name, v.last_name], ['7', 'Johnny', 'Vance']);
  // Batting H/BB/SO are his batting line; the pitching ones are what he allowed.
  assert.deepEqual([v.counts.b_h, v.counts.b_bb, v.counts.b_so, v.counts.b_sb, v.counts.b_cs], [9, 6, 6, 4, 1]);
  assert.deepEqual([v.counts.p_h, v.counts.p_bb, v.counts.p_so, v.counts.p_er, v.counts.p_wp], [12, 6, 14, 7, 2]);
  assert.equal(v.counts.p_outs, 29);
  assert.equal(v.counts.p_pitches, 170);
  // No number, dashes and blanks: zeros, never NaN.
  assert.equal(p.number, '');
  assert.equal(p.counts.b_rbi, 0);
  assert.equal(p.counts.p_outs, 0);
});

test('a file that is not a GameChanger export says so', () => {
  assert.throws(() => parseGameChanger('Name,AVG\nAva,.300\n'), /GameChanger stats export/);
});

test('CSV: quotes, doubled quotes, commas and line breaks inside a cell', () => {
  assert.deepEqual(parseCsv('"a,b","say ""hi""","two\nlines"\r\nx,y,z'), [['a,b', 'say "hi"', 'two\nlines'], ['x', 'y', 'z']]);
});

test('innings in thirds', () => {
  assert.equal(inningsToOuts('9.2'), 29);
  assert.equal(inningsToOuts('0.1'), 1);
  assert.equal(inningsToOuts('12'), 36);
  assert.equal(inningsToOuts('-'), 0);
  assert.equal(innings(29), '9.2');
});

test('rows find their roster player: number and last name, full name, then number alone', () => {
  const { rows } = parseGameChanger(FILE);
  const roster = [
    { id: 'a', number: '7', first_name: 'Johnny', last_name: 'Vance' },
    { id: 'b', number: '3', first_name: 'Cy', last_name: 'Park' },
  ];
  assert.deepEqual(matchRows(rows, roster), ['a', 'b']);
  // A number two players share matches neither; a new kid matches nobody.
  assert.deepEqual(matchRows(rows, [
    { id: 'x', number: '7', first_name: 'Other', last_name: 'Kid' },
    { id: 'y', number: '7', first_name: 'Third', last_name: 'Kid' },
  ]), [null, null]);
});

const line = (o: Partial<SeasonLine>): SeasonLine => ({
  player_id: 'p', season_id: 's', imported_at: null,
  b_g: 0, b_pa: 0, b_ab: 0, b_h: 0, b_2b: 0, b_3b: 0, b_hr: 0, b_rbi: 0, b_r: 0, b_bb: 0, b_so: 0, b_kl: 0,
  b_hbp: 0, b_sac: 0, b_sf: 0, b_roe: 0, b_fc: 0, b_sb: 0, b_cs: 0,
  p_g: 0, p_gs: 0, p_outs: 0, p_bf: 0, p_pitches: 0, p_w: 0, p_l: 0, p_sv: 0, p_h: 0, p_r: 0, p_er: 0,
  p_bb: 0, p_so: 0, p_hbp: 0, p_wp: 0, p_bk: 0, ...o,
});

test('rates match GameChanger\'s own', () => {
  // The design canvas's #7: 9-for-33, 2 doubles, a homer, 6 walks, a hit by pitch.
  const b = batting(line({ b_ab: 33, b_h: 9, b_2b: 2, b_hr: 1, b_bb: 6, b_hbp: 1 }));
  assert.deepEqual([rate3(b.avg), rate3(b.obp), rate3(b.slg), rate3(b.ops)], ['.273', '.400', '.424', '.824']);
  // A real export's team line: 42 ER over 9.2 innings is a 30.41 ERA at 7 innings a game.
  const p = pitching(line({ p_outs: 29, p_er: 42, p_h: 32, p_bb: 28 }));
  assert.equal(rate2(p.era), '30.41');
  assert.equal(rate2(p.whip), '6.21');
  assert.equal(rate3(batting(line({})).avg), '–');
  assert.equal(rate3(1.1617), '1.162');
});
