// The fact check a written recap must pass: scores the game passed through,
// innings that were played, a player of the game the facts name, and an X
// post that fits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkRecap, recapPrompt, RecapContent, RECAP_SYSTEM } from '../lib/recap.ts';
import { summarizeGame, type GameFacts } from '../lib/summarize.ts';

type V4 = { is_home: boolean; live: Record<string, unknown>; plays: [string, string, string, string, string][] };
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/v4-games.json', import.meta.url), 'utf8')) as Record<string, V4>;
const factsOf = (name: string): GameFacts => {
  const g = fixtures[name];
  return summarizeGame({
    game: { is_home: g.is_home, status: 'final', live: g.live, sport: 'baseball' },
    teams: { us: 'Blue Steel', them: name.toUpperCase() },
    events: g.plays.map(([inning, half, kind, code, runs], i) => ({
      id: i + 1, seq: i + 1, type: kind, prev_live: {},
      payload: { source: 'v4', play: { inning: Number(inning), half, kind, code, runs: Number(runs) } },
    })),
  });
};

const good = (over: Partial<RecapContent> = {}): RecapContent => ({
  headline: 'Desperados top Blue Steel 9-2',
  recap: 'Blue Steel jumped out 2-0 in the 1st on a groundout 6-3 and a bases-loaded walk.\n\nThe Desperados answered with eight in the 2nd to win 9-2.',
  social: { instagram: 'Tough one today. #BlueSteel', facebook: 'We led 2-0 early.', x: 'Final: 9-2. On to the next one. #BlueSteel' },
  website_post: { title: 'Desperados 9, Blue Steel 2', body_markdown: '| | 1 | 2 | 3 |\n|-|-|-|-|\n| Steel | 2 | 0 | 0 |' },
  player_of_the_game: { name_or_number: '', reason: '' },
  ...over,
});

test('a recap that sticks to the facts passes', () => {
  assert.deepEqual(checkRecap(good(), factsOf('desp')), []);
});

test('a score the game never had is caught; play codes and real scores are not', () => {
  const p = checkRecap(good({ headline: 'Desperados top Blue Steel 10-2' }), factsOf('desp'));
  assert.equal(p.length, 1);
  assert.match(p[0], /"10-2"/);
  // 2-2 happened (a tie in the 2nd); 3-2 did too, the go-ahead run.
  assert.deepEqual(checkRecap(good({ recap: 'Tied 2-2, then 3-2 Desperados.' }), factsOf('desp')), []);
});

test('an inning the game did not reach is caught', () => {
  const p = checkRecap(good({ recap: 'A big 5th inning sealed it.' }), factsOf('desp'));
  assert.deepEqual(p, ['"5th": the game had 3 innings.']);
});

test('a v4 game with gaps: the line score’s running totals still count as real scores', () => {
  // Krum: 2-0 Krum after the top of the 1st, 4-2 us after the bottom (two of those runs are a gap).
  assert.deepEqual(checkRecap(good({ headline: 'Blue Steel 10-2', recap: 'Down 2-0, we led 4-2 after one.', social: { instagram: '', facebook: '', x: '10-2 win' } }), factsOf('krum')), []);
});

test('the player of the game must be someone the facts name', () => {
  const p = checkRecap(good({ player_of_the_game: { name_or_number: 'Johnny Vance', reason: 'Two hits.' } }), factsOf('desp'));
  assert.match(p[0], /not a player the facts name/);
});

test('an X post over 280 characters is caught', () => {
  const p = checkRecap(good({ social: { instagram: '', facebook: '', x: 'x'.repeat(281) } }), factsOf('desp'));
  assert.deepEqual(p, ['The X post is 281 characters; the limit is 280.']);
});

test('the prompt carries the facts and the rules, and the system prompt is fixed', () => {
  const facts = factsOf('krum');
  const prompt = recapPrompt(facts, { team: 'Blue Steel', opponent: 'Krum', date: 'Monday, October 6, 2026', venue: null, season: 'Fall 2026', ageGroup: '9U' });
  assert.match(prompt, /<facts>\n\{.*"gaps":\[\{"inning":1,"half":"bottom","side":"us","runs":2\}\]/s);
  assert.match(prompt, /Age group: 9U/);
  assert.match(RECAP_SYSTEM, /gaps/);
  assert.ok(!/\d{4}-\d{2}-\d{2}T/.test(RECAP_SYSTEM), 'nothing that changes per call in the system prompt');
});
