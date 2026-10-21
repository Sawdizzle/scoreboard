// Breaks in play: when the music bed plays and the mic is muted, and the credit the tracks need.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakOf, CREDIT, DEFAULT_TRACK, TRACKS, trackOf } from '../lib/music.ts';
import type { Feed } from '../lib/onair.ts';

const feed = (over: Record<string, unknown> = {}, game: Record<string, unknown> = {}) =>
  ({ card: null, auto_mid: true, last: { seq: 5, type: 'out', kind: null, rolled: false }, broadcast: {}, ...over,
    game: { id: 'g1', sport: 'baseball', status: 'live', ...game } }) as unknown as Feed;

test('a full-frame scene is a break, whatever the game is doing', () => {
  assert.equal(breakOf(feed({ broadcast: { scene: { kind: 'starting' } } }, { status: 'scheduled' })), 'starting');
  assert.equal(breakOf(feed({ broadcast: { scene: { kind: 'paused', reason: 'rain' } } })), 'paused');
  assert.equal(breakOf(feed({ broadcast: { scene: { kind: 'final' } } }, { status: 'final' })), 'final');
});

test('the mid-inning board is a break when it is up by itself or held from the pad', () => {
  assert.equal(breakOf(feed()), null);
  assert.equal(breakOf(feed({ last: { seq: 5, type: 'out', kind: null, rolled: true } })), 'mid');
  assert.equal(breakOf(feed({ card: 'mid' })), 'mid');
  // Taken down from the pad, or another card held over it: play is on.
  assert.equal(breakOf(feed({ last: { seq: 5, type: 'out', kind: null, rolled: true }, broadcast: { mid_off: { game: 'g1', seq: 5 } } })), null);
  assert.equal(breakOf(feed({ card: 'batter', last: { seq: 5, type: 'out', kind: null, rolled: true } })), null);
  // The board shows only for a baseball game in play.
  assert.equal(breakOf(feed({ card: 'mid' }, { status: 'scheduled' })), null);
  assert.equal(breakOf(feed({ card: 'mid' }, { sport: 'soccer' })), null);
  assert.equal(breakOf(null), null);
});

test('every break has a track, and the credit names each chosen one once', () => {
  for (const id of Object.values(DEFAULT_TRACK)) assert.ok(trackOf(id));
  const c = CREDIT(['tessera', 'dyo']);
  assert.equal(c.split('\n').length, 2);
  assert.match(c, /Sascha Ende/);
  assert.match(c, /CC BY 4\.0/);
  assert.equal(new Set(TRACKS.map((t) => t.id)).size, TRACKS.length);
});
