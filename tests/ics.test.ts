import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, esc, fold } from '../lib/ics.ts';

const feed = {
  team: { name: 'Blue Steel', slug: 'blue-steel' },
  games: [{ id: 'g1', starts_at: '2026-11-01T17:00:00.000Z', opponent: 'River, Sanger', is_home: false, venue: 'Field 3',
    address: '1 Field Rd', status: 'scheduled', updated_at: '2026-10-27T10:00:00.000Z' }],
  events: [{ id: 'e1', kind: 'practice', title: 'Practice', starts_at: '2026-10-30T23:00:00.000Z', ends_at: null,
    location: null, address: null, notes: 'Bring water;\nand a glove', canceled: true, updated_at: '2026-10-27T11:00:00.000Z' }],
};

test('a game and a practice, in UTC, with their own ids and the escapes calendars need', () => {
  const ics = buildIcs(feed, 'https://sb.example.test');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.match(ics, /UID:game-g1@scoreboard\r\nDTSTAMP:20261027T100000Z/);
  assert.match(ics, /DTSTART:20261101T170000Z\r\nDTEND:20261101T190000Z/);
  assert.match(ics, /SUMMARY:Blue Steel at River\\, Sanger/);
  assert.match(ics, /LOCATION:Field 3\\, 1 Field Rd/);
  // A practice with no end runs 90 minutes; a canceled one says so.
  assert.match(ics, /DTSTART:20261030T230000Z\r\nDTEND:20261031T003000Z/);
  assert.match(ics, /DESCRIPTION:Bring water\\;\\nand a glove/);
  assert.match(ics, /STATUS:CANCELED/);
  assert.equal(ics.split('BEGIN:VEVENT').length, 3);
});

test('long lines fold at 75 octets without splitting a character', () => {
  const line = `SUMMARY:${'é'.repeat(60)}`;
  const parts = fold(line).split('\r\n ');
  assert.ok(parts.length > 1);
  for (const p of parts) assert.ok(new TextEncoder().encode(p).length <= 75);
  assert.equal(parts.join(''), line);
  assert.equal(esc('a\\b'), 'a\\\\b');
});
