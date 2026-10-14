import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoster, parseRosterLine } from '../lib/roster-parse.ts';
import { abbrFor, publicName } from '../lib/format.ts';

test('the shapes people paste', () => {
  assert.deepEqual(parseRosterLine('7 Ava Reyes SS'), { number: '7', first_name: 'Ava', last_name: 'Reyes', positions: ['SS'] });
  assert.deepEqual(parseRosterLine('#12 Ben Ortiz (P)'), { number: '12', first_name: 'Ben', last_name: 'Ortiz', positions: ['P'] });
  assert.deepEqual(parseRosterLine('3. Cy Park - CF'), { number: '3', first_name: 'Cy', last_name: 'Park', positions: ['CF'] });
  assert.deepEqual(parseRosterLine('Finn Moore'), { number: '', first_name: 'Finn', last_name: 'Moore', positions: [] });
  assert.deepEqual(parseRosterLine('21'), { number: '21', first_name: '', last_name: '', positions: [] });
  assert.deepEqual(parseRosterLine('No. 4\tJuan De La Cruz, 1b'), { number: '4', first_name: 'Juan', last_name: 'De La Cruz', positions: ['1B'] });
  assert.deepEqual(parseRosterLine('Reyes, Ava'), { number: '', first_name: 'Ava', last_name: 'Reyes', positions: [] });
  assert.deepEqual(parseRosterLine('9 Leo Kim UT'), { number: '9', first_name: 'Leo', last_name: 'Kim', positions: ['UT'] });
});

test('a name that only ends like a position keeps its letters', () => {
  assert.deepEqual(parseRosterLine('8 Marc'), { number: '8', first_name: 'Marc', last_name: '', positions: [] });
  assert.deepEqual(parseRosterLine('14 Skip'), { number: '14', first_name: 'Skip', last_name: '', positions: [] });
});

test('blank lines drop out of a pasted list', () => {
  assert.equal(parseRoster('7 Ava Reyes SS\n\n   \n#12 Ben Ortiz (P)\r\n21\n').length, 3);
  assert.equal(parseRosterLine('   '), null);
});

test('public names match what public_roster() returns', () => {
  const p = { first_name: 'Johnny', last_name: 'Vance', number: '7' };
  assert.equal(publicName(p, 'full'), 'Johnny Vance');
  assert.equal(publicName(p, 'first_initial'), 'Johnny V.');
  assert.equal(publicName(p, 'number'), 'No. 7');
  assert.equal(publicName({ first_name: '', last_name: '', number: '7' }, 'full'), 'No. 7');
});

test('a scorebug abbreviation from a team name', () => {
  assert.equal(abbrFor('Blue Steel'), 'STEEL');
  assert.equal(abbrFor('River'), 'RIVER');
  assert.equal(abbrFor('Riverside Rockets'), 'RR');
  assert.equal(abbrFor(''), '');
});
