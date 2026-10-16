// The recap test set's grader, on known-good and known-bad recaps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gradeRecap } from '../lib/recap-grade.ts';
import type { RecapContent } from '../lib/recap.ts';
import { summarizeGame, type SummaryInput } from '../lib/summarize.ts';

const facts = (f: string) => summarizeGame((JSON.parse(readFileSync(new URL(`./fixtures/recap-cases/${f}.json`, import.meta.url), 'utf8')) as { input: SummaryInput }).input);
const pack = (recap: string, headline = 'Blue Steel beat Krum 14u 10-2'): RecapContent => ({
  headline, recap, social: { instagram: '', facebook: '', x: 'Won 10-2' },
  website_post: { title: '', body_markdown: '' }, player_of_the_game: { name_or_number: '', reason: '' },
});

test('every case file loads and summarizes', () => {
  for (const f of ['v4-desp', 'v4-krum']) assert.equal(facts(f).final, true);
});

test('a good Krum recap passes', () => {
  const g = gradeRecap(pack('Krum scored twice in the top of the 1st.\n\nBlue Steel answered with four in the bottom half.\n\nA two-run 2nd and a four-run 3rd made it 10-2.'), facts('v4-krum'));
  assert.deepEqual(g, { pass: true, problems: [] });
});

test('narrating the missing 1st-inning runs, a wrong score, one paragraph: all caught', () => {
  const g = gradeRecap(pack('In the 1st a single drove in two runs and we led 5-2.', 'Steel win'), facts('v4-krum'));
  assert.equal(g.pass, false);
  assert.deepEqual(g.problems, [
    '"5-2" is not a score or play code from the facts.',
    'The recap has 1 paragraphs; it should have 3 to 5.',
    'Neither the headline nor the recap gives the final score (10-2).',
    'The recap may explain the 1st-inning runs the log is missing.',
  ]);
});
