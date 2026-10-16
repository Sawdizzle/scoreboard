// Games picked out of a pasted schedule: times in the team's zone, the check,
// duplicates, and a web page's text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alreadyThere, checkSchedule, localToIso, pageText, plausibleStart, sameOpponent, scheduleNotes, type Found } from '../lib/schedule-import.ts';

test('local times become instants in Central time, either side of the clock change', () => {
  assert.equal(localToIso('2026-10-17', '09:45'), '2026-10-17T14:45:00.000Z'); // CDT, UTC-5
  assert.equal(localToIso('2026-11-07', '13:15'), '2026-11-07T19:15:00.000Z'); // CST, UTC-6
  assert.equal(localToIso('2026-10-17', ''), '2026-10-17T17:00:00.000Z');      // no time: noon
  assert.equal(localToIso('10/17/2026', '9:45'), null);
  assert.equal(localToIso('2026-10-17', '25:00'), null);
});

const f = (o: Partial<Found>): Found => ({ date: '2026-10-17', time: '09:45', opponent: 'The Express', home: 'away', venue: '', address: '', note: '', ...o });

test('the check retries only what must be fixed; a far-off year is a note for the coach', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  assert.deepEqual(checkSchedule({ games: [f({})], unsure: [] }), []);
  assert.deepEqual(checkSchedule({ games: [f({ opponent: ' ' }), f({ date: 'Oct 17' })], unsure: [] }), [
    'A game on 2026-10-17 has no opponent.', '"Oct 17 09:45" is not a date and time.']);
  assert.deepEqual(scheduleNotes({ games: [f({ date: '2027-09-20' }), f({ date: '2026-09-20' })], unsure: [] }, now), ['2027-09-20 vs The Express is far from today: check the year.']);
  assert.equal(plausibleStart('2026-10-17T14:45:00Z', now), true);
  assert.equal(plausibleStart('9999-01-01T00:00:00Z', now), false);
});

test('a game already on the schedule: same day in Central time, overlapping opponent name', () => {
  const existing = [{ starts_at: '2026-10-17T14:45:00Z', opponent_name: 'The Express Baseball Club' }];
  assert.equal(alreadyThere(f({}), existing), true);
  assert.equal(alreadyThere(f({ opponent: 'Express' }), existing), true);
  assert.equal(alreadyThere(f({ opponent: 'Lonestar' }), existing), false);
  assert.equal(alreadyThere(f({ date: '2026-10-18' }), existing), false);
  // A shared first word is not the same team; an empty name matches nothing.
  assert.equal(sameOpponent('Blue Sox', 'Blue Steel'), false);
  assert.equal(alreadyThere(f({ opponent: ' - ' }), existing), false);
  // 11 pm Central on the 17th is the 18th in UTC: still the 17th here.
  assert.equal(alreadyThere(f({}), [{ starts_at: '2026-10-18T04:00:00Z', opponent_name: 'The Express' }]), true);
});

test('a page’s text: scripts, styles and tags gone, rows on their own lines', () => {
  const t = pageText('<html><style>x{}</style><script>alert(1)</script><table><tr><td>Sat 10/17</td><td>9:45 AM</td><td>Blue Steel &amp; Express</td></tr><tr><td>Sat</td></tr></table></html>');
  assert.equal(t, 'Sat 10/17 9:45 AM Blue Steel & Express\nSat');
});
