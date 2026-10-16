// A lineup read from a photo becomes paste-box lines the scorer checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLineup, lineupLines } from '../lib/lineup-photo.ts';
import { parseRoster } from '../lib/roster-parse.ts';

const read = (players: [string, string, string][], unsure: string[] = []) => ({ players: players.map(([number, name, position]) => ({ number, name, position })), unsure });

test('rows become the lines the paste box already understands', () => {
  const lines = lineupLines(read([['7', 'Ava Reyes', 'SS'], ['#12', 'Ben Ortiz', '1'], ['21', '', ''], ['', 'Cy Park', 'cf'], ['5', 'Dee Lane', 'EH']]));
  assert.deepEqual(lines, ['7 Ava Reyes SS', '12 Ben Ortiz P', '21', 'Cy Park CF', '5 Dee Lane']);
  assert.deepEqual(parseRoster(lines.join('\n')).map((p) => [p.number, p.first_name, p.last_name, p.positions.join()]),
    [['7', 'Ava', 'Reyes', 'SS'], ['12', 'Ben', 'Ortiz', 'P'], ['21', '', '', ''], ['', 'Cy', 'Park', 'CF'], ['5', 'Dee', 'Lane', '']]);
});

test('empty rows are dropped; a name that kept its number is cleaned', () => {
  assert.deepEqual(lineupLines(read([['', '', ''], ['9', '9 Finn Moore', 'C']])), ['9 Finn Moore C']);
});

test('the check catches a number read twice and a bench read in', () => {
  assert.deepEqual(checkLineup(read([['7', 'A', ''], ['7', 'B', '']])), ['Number 7 appears twice: check the photo.']);
  assert.deepEqual(checkLineup(read(Array.from({ length: 16 }, (_, i) => [String(i + 1), '', ''] as [string, string, string]))), ['More than 15 batters: the bench may have been read in.']);
  assert.deepEqual(checkLineup(read([])), []);
});
