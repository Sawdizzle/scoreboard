// Auto-clips: which moments clip, how close moments merge, and how a saved
// clip reads on the game page and in the YouTube description.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipMarks, clipText, DEFAULT_CLIP_KINDS, joinClip, kindsFor, mainKind, MERGE_MS, viewClips, wantClip, type ClipRow } from '../lib/clips.ts';
import { description } from '../lib/youtube.ts';

test('the default kinds are the ones auto-clip always saved; new kinds start off', () => {
  assert.deepEqual(DEFAULT_CLIP_KINDS, ['homerun', 'walkoff', 'doubleplay', 'bigplay', 'touchdown', 'goal']);
  assert.equal(wantClip('homerun', undefined), true);
  assert.equal(wantClip('strikeout', undefined), false);
  assert.equal(wantClip('strikeout', ['strikeout']), true);
  assert.equal(wantClip('homerun', []), false);
  assert.equal(wantClip('charge', ['charge']), false);
});

test('each sport offers its own kinds, and big plays everywhere', () => {
  assert.deepEqual(kindsFor('football').map((k) => k.key), ['bigplay', 'touchdown']);
  assert.ok(kindsFor('baseball').some((k) => k.key === 'stolenbase'));
  assert.ok(!kindsFor('baseball').some((k) => k.key === 'goal'));
});

test('moments close together are one clip, saved after whichever ends later', () => {
  const a = joinClip(null, 'doubleplay', 1000);
  assert.equal(a.merged, false);
  assert.equal(a.clip.fireAt, 11000);
  const b = joinClip(a.clip, 'homerun', 1000 + MERGE_MS);
  assert.equal(b.merged, true);
  assert.equal(b.clip.n, 1000);
  assert.equal(b.clip.fireAt, 1000 + MERGE_MS + 40000);
  assert.deepEqual(b.clip.kinds, ['doubleplay', 'homerun']);
  assert.equal(mainKind(b.clip.kinds), 'homerun');
  // Too long after the first moment: a clip of its own.
  assert.equal(joinClip(a.clip, 'run', 1000 + MERGE_MS + 1).merged, false);
});

const row = (o: Partial<ClipRow>): ClipRow => ({ id: 1, n: 1, kind: 'homerun', kinds: ['homerun'], source: 'auto', seq: 4, inning: 3, half: 'bottom',
  away_score: 2, home_score: 4, moment_at: '2026-10-17T15:20:00Z', status: 'saved', code: null, ...o });

test('a clip reads like the scorebug, and is placed in the stream', () => {
  assert.equal(clipText(row({})), 'Bottom 3rd · Home run · 2-4');
  assert.equal(clipText(row({ kind: 'manual', inning: null, away_score: null })), 'Saved from the pad');
  const now = Date.parse('2026-10-17T16:00:00Z');
  const [v] = viewClips([row({})], '2026-10-17T15:00:00Z', now);
  assert.equal(v.offset, 1200);
  assert.equal(v.shown, 'saved');
  assert.equal(viewClips([row({})], null, now)[0].offset, null);
});

test('an undone play’s clip is discarded; one OBS never answered is missed', () => {
  const now = Date.parse('2026-10-17T16:00:00Z');
  const v = viewClips([row({ id: 1, status: 'discarded' }), row({ id: 2, status: 'asked' }), row({ id: 3, status: 'armed', moment_at: '2026-10-17T15:59:30Z' })], null, now);
  assert.deepEqual(v.map((c) => c.shown), ['discarded', 'missed', 'pending']);
});

test('saved clips are the description’s highlights; runs stay in scoring plays', () => {
  const marks = clipMarks([row({}), row({ id: 2, kind: 'run' }), row({ id: 3, status: 'missed' })]);
  assert.deepEqual(marks, [{ at: '2026-10-17T15:20:00Z', label: 'Bottom 3rd · Home run · 2-4' }]);
  const facts = { teams: { us: 'Steel', them: 'Hawks', home: 'us' }, score: { us: 4, them: 2 },
    lineScore: { innings: [], us: { r: 4, h: 5, e: 0 }, them: { r: 2, h: 3, e: 1 } } } as never;
  const text = description({ text: { title: 't', intro: 'i', hashtags: [] }, facts, halves: [], scoring: [], highlights: marks, streamStart: '2026-10-17T15:00:00Z' });
  assert.match(text, /Highlights\n20:00 Bottom 3rd · Home run · 2-4/);
});
