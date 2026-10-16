// The pregame blurb: the facts it is written from (record, streak, last games,
// earlier meetings), and the check that keeps it to them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLURB_SYSTEM, blurbPrompt, checkBlurb, matchupFacts, type BlurbContent, type PastGame } from '../lib/blurb.ts';

const S = 'season-fall', OLD = 'season-spring';
let n = 0;
// A game on a date, us home or away, with our runs and theirs.
const g = (date: string, opp: string, us: number, them: number, o: Partial<PastGame> = {}): PastGame => {
  const is_home = o.is_home ?? true;
  return {
    id: `g${++n}`, starts_at: `${date}T15:00:00Z`, is_home, status: 'final', counts_for_stats: true, season_id: S,
    opponent_team_id: null, opponent_id: null, opponent_name: opp, sport: 'baseball',
    live: is_home ? { home_score: us, away_score: them } : { home_score: them, away_score: us }, ...o,
  };
};
const today: PastGame = { ...g('2026-10-17', 'Hawks', 0, 0), status: 'scheduled', live: {}, starts_at: '2026-10-17T14:45:00Z' };

const history = [
  g('2026-09-14', 'Hawks', 2, 9),                                  // L 9-2
  g('2026-09-20', 'Rapids', 15, 1, { is_home: false }),            // W 15-1
  g('2026-09-27', 'Comets', 4, 4),                                 // T 4-4
  g('2026-10-03', 'Rapids', 6, 5),                                 // W 6-5
  g('2026-10-06', 'Krum', 10, 2),                                  // W 10-2
  g('2026-09-01', 'Hawks', 1, 3, { season_id: OLD }),              // last season: no record, still a meeting
  g('2026-09-28', 'Scrimmage', 20, 0, { counts_for_stats: false }), // a scrimmage: no record
  g('2026-10-20', 'Hawks', 5, 0),                                  // after today: ignored
  { ...g('2026-10-10', 'Owls', 7, 1), sport: 'football' },          // another sport: ignored
];
const facts = () => matchupFacts({ game: today, games: [...history, today], teams: { us: 'Blue Steel', them: 'Hawks' }, venue: 'Railyard Park', season: 'Fall 2026' });

test('the record counts this season’s final games before today, scrimmages and other sports left out', () => {
  const f = facts();
  assert.deepEqual(f.record, { w: 3, l: 1, t: 1, text: '3-1-1' });
  assert.deepEqual(f.streak, { result: 'W', games: 2 });
});

test('last games are the newest three, scores winner first', () => {
  assert.deepEqual(facts().last.map((x) => [x.opponent, x.result, x.score]), [
    ['Krum', 'W', '10-2'], ['Rapids', 'W', '6-5'], ['Scrimmage', 'W', '20-0']]);
});

test('earlier meetings with this opponent, any season, newest first', () => {
  assert.deepEqual(facts().meetings.map((x) => [x.result, x.score]), [['L', '9-2'], ['L', '3-1']]);
});

test('an opponent saved under a different name still matches by id', () => {
  const f = matchupFacts({
    game: { ...today, opponent_id: 'opp-hawks', opponent_name: 'The Hawks' },
    games: [g('2026-10-01', 'Hawks 14U', 8, 3, { opponent_id: 'opp-hawks' })],
    teams: { us: 'Blue Steel', them: 'The Hawks' }, venue: null, season: null,
  });
  assert.deepEqual(f.meetings.map((x) => x.score), ['8-3']);
});

test('date and time are in the team’s time zone', () => {
  const f = facts();
  assert.equal(f.date, 'Saturday, October 17');
  assert.equal(f.time, '9:45 AM');
});

const ok: BlurbContent = { line1: 'Blue Steel host the Hawks at Railyard Park', line2: 'Steel are 3-1-1 this fall, winners of two straight', storyline: 'Rematch: the Hawks took the last one 9-2' };

test('a blurb that sticks to the facts passes', () => {
  assert.deepEqual(checkBlurb(ok, facts()), []);
});

test('a record or score the facts do not have is caught', () => {
  const p = checkBlurb({ ...ok, line2: 'Steel are 4-1 this fall', storyline: 'The Hawks won 7-2 last time' }, facts());
  assert.deepEqual(p, ['"4-1" is not a record or score from the facts.', '"7-2" is not a record or score from the facts.']);
});

test('a line over 60 characters is caught, and line1 must not be empty', () => {
  const p = checkBlurb({ line1: '', line2: 'x'.repeat(61), storyline: '' }, facts());
  assert.deepEqual(p, ['line2 is 61 characters; the limit is 60.', 'line1 must not be empty.']);
});

test('the prompt carries the facts; the system prompt rules out names and invention', () => {
  assert.match(blurbPrompt(facts()), /<facts>\n\{.*"record":\{"w":3,"l":1,"t":1,"text":"3-1-1"\}/s);
  assert.match(BLURB_SYSTEM, /Never name a player/);
  assert.match(BLURB_SYSTEM, /Never invent/);
});

test('a record at the end of a sentence is still checked', () => {
  assert.deepEqual(checkBlurb({ ...ok, line2: 'Steel are 4-1.' }, facts()), ['"4-1" is not a record or score from the facts.']);
});
