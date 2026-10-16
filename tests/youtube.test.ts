// The game video's chapters and description, from the play log's times.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapters, checkYoutube, description, stamp, videoMarks, type YoutubeText } from '../lib/youtube.ts';
import { knownScores, scoreProblems } from '../lib/recap.ts';
import { summarizeGame, type SummaryEvent } from '../lib/summarize.ts';

const T0 = Date.parse('2026-10-17T14:40:00Z'); // the stream goes live
const at = (min: number) => new Date(T0 + min * 60000).toISOString();
// A short pad-style log: [minute, half, inning, type, kind, score after (home-away)]
type Row = [number, 'top' | 'bottom', number, string, string | null, [number, number]];
function log(rows: Row[]): SummaryEvent[] {
  let before = { home_score: 0, away_score: 0, inning: 1, half: 'top' };
  return rows.map(([min, half, inning, type, kind, [h, a]], i) => {
    const e: SummaryEvent = { id: i + 1, seq: i + 1, type, prev_live: { ...before, inning, half },
      payload: { at: at(min), ...(kind ? { play: { kind, half, inning, code: '' } } : {}) }, created_at: at(min + 30) };
    before = { home_score: h, away_score: a, inning, half };
    return e;
  });
}
const rows: Row[] = [
  [5, 'top', 1, 'strike', null, [0, 0]], [7, 'top', 1, 'strikeout', 'K', [0, 0]],
  [12, 'bottom', 1, 'ball', null, [0, 0]], [14, 'bottom', 1, 'hit', 'H2', [2, 0]],
  [25, 'top', 2, 'out', 'OUT', [2, 0]], [33, 'bottom', 2, 'homerun', 'HR', [3, 0]], [40, 'top', 3, 'end_game', null, [3, 0]],
];
const live = { home_score: 3, away_score: 0, inning: 3, half: 'top', line_score: [{ top: 0, bottom: 2 }, { top: 0, bottom: 1 }] };
const facts = summarizeGame({ game: { is_home: true, status: 'final', live, sport: 'baseball' }, teams: { us: 'Blue Steel', them: 'Hawks' }, events: log(rows) });

test('marks: each half starts at its first pitch, tap time over save time; each scoring play is timed', () => {
  const m = videoMarks(log(rows), facts);
  assert.deepEqual(m.halves.map((x) => [x.at, x.label]), [[at(5), 'Top 1st'], [at(12), 'Bottom 1st · 2 runs'], [at(25), 'Top 2nd'], [at(33), 'Bottom 2nd · 1 run']]);
  assert.deepEqual(m.scoring.map((x) => [x.at, x.label]), [[at(14), 'Bottom 1st · Double, 2 runs'], [at(33), 'Bottom 2nd · Home run, 1 run']]);
  assert.equal(m.first, at(5));
});

test('chapters: 0:00 first, in order, 10 s apart, three or none', () => {
  const m = videoMarks(log(rows), facts);
  assert.deepEqual(chapters(m.halves, new Date(T0).toISOString()), ['0:00 Pregame', '5:00 Top 1st', '12:00 Bottom 1st · 2 runs', '25:00 Top 2nd', '33:00 Bottom 2nd · 1 run']);
  assert.deepEqual(chapters([{ at: at(0.05), label: 'Top 1st' }, { at: at(0.1), label: 'x' }, { at: at(1), label: 'Bottom 1st' }], new Date(T0).toISOString()), []);
  assert.equal(stamp(3723), '1:02:03');
});

test('v4 games, every play stamped at import: no chapters', () => {
  const flat = log(rows).map((e) => ({ ...e, payload: { ...(e.payload ?? {}), at: undefined }, created_at: at(0) }));
  assert.deepEqual(videoMarks(flat, facts), { halves: [], scoring: [], first: null });
});

test('the description: intro, final, line score, chapters, scoring plays, hashtags', () => {
  const m = videoMarks(log(rows), facts);
  const text: YoutubeText = { title: 'Blue Steel 3, Hawks 0 (Oct 17)', intro: 'A shutout at home.', hashtags: ['BlueSteel', '#YouthBaseball'] };
  const d = description({ text, facts, ...m, streamStart: new Date(T0).toISOString() });
  assert.equal(d, ['A shutout at home.', '', 'Final: Hawks 0, Blue Steel 3', 'Hawks: 0 0  (R 0, H 0, E 0)', 'Blue Steel: 2 1  (R 3, H 0, E 0)',
    '', 'Chapters', '0:00 Pregame', '5:00 Top 1st', '12:00 Bottom 1st · 2 runs', '25:00 Top 2nd', '33:00 Bottom 2nd · 1 run',
    '', 'Scoring plays', '14:00 Bottom 1st · Double, 2 runs', '33:00 Bottom 2nd · Home run, 1 run', '', '#BlueSteel #YouthBaseball'].join('\n'));
  assert.ok(!description({ text, facts, ...m, streamStart: null }).includes('Chapters'));
});

test('the check: a score the game never had, a long title, angle brackets', () => {
  const known = knownScores(facts);
  assert.deepEqual(checkYoutube({ title: 'Steel win 3-0', intro: 'Up 2-0 early.', hashtags: [] }, known, scoreProblems), []);
  assert.deepEqual(checkYoutube({ title: 'Steel win 4-0 <live>', intro: '', hashtags: [] }, known, scoreProblems),
    ['No angle brackets: YouTube rejects them.', '"4-0" is not a score or play code from the facts.']);
});
