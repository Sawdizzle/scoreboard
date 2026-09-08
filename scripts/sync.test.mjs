// The pad's write queue.
//
// This is the path every score travels, and until this file existed it was the
// least covered code in the project — exercising it in a browser needs a
// signed-in session and a dead network at the same time. js/sync.js takes all
// of its effects through an injected `io`, so here a lost connection, a stale
// stinger and two interleaved games are a few lines each.
//
// Run: node --test scripts/sync.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load-module.mjs';

const { createQueue, STALE_ANIM_MS, IO_KEYS } = await loadModule('js/sync.js');

// A recording io. `fail` makes the next N calls return an error; `clock` is the
// queue's whole notion of time, so a stale stinger costs no real milliseconds.
function harness(over = {}) {
  const h = {
    sent: [],          // {kind, gameId, type, patch, payload}
    badges: [],        // [count, err]
    accepted: [],      // [row, gameId, settled]
    toasts: [],        // [message, ms]
    authErrors: [],
    retries: 0,
    clock: 1000,
    paused: false,
    error: null,       // {message} returned instead of data while set
    row: (gameId) => ({ id: gameId, v: h.sent.length }),
  };
  let retry = null;
  const send = (entry) => {
    h.sent.push(entry);
    return h.error ? { data: null, error: h.error } : { data: h.row(entry.gameId), error: null };
  };
  h.io = {
    applyEvent: async (gameId, type, patch, payload) => send({ kind: 'event', gameId, type, patch, payload }),
    updateFields: async (gameId, patch) => send({ kind: 'field', gameId, patch }),
    onPending: (n, err) => h.badges.push([n, err]),
    onAccepted: (row, gameId, settled) => h.accepted.push([row, gameId, settled]),
    onToast: (m, ms) => h.toasts.push([m, ms]),
    onAuthError: (m) => h.authErrors.push(m),
    isPaused: () => h.paused,
    retry: (fn) => { h.retries++; retry = fn; },
    stopRetry: () => { retry = null; },
    now: () => h.clock,
    ...over,
  };
  h.q = createQueue(h.io);
  h.fireRetry = () => retry && retry();      // stand in for the 4s timer
  return h;
}

const play = (gameId, type, patch = {}) => ({ kind: 'event', gameId, type, patch, payload: {} });
const field = (gameId, patch) => ({ kind: 'field', gameId, patch });

// ===========================================================================
// Order and addressing
// ===========================================================================
test('writes drain in the order they were made', async () => {
  const h = harness();
  h.q.enqueue(play('g1', 'ball'));
  h.q.enqueue(play('g1', 'strike'));
  h.q.enqueue(play('g1', 'run'));
  await h.q.drain();
  assert.deepEqual(h.sent.map((w) => w.type), ['ball', 'strike', 'run']);
  assert.equal(h.q.size(), 0);
});

test('each write is addressed to its OWN game, not to whatever is open now', async () => {
  // The cross-game bug: score in g1, back out, open g2, network returns. Every
  // patch holds absolute values, so a g1 patch sent to g2 overwrites g2's score.
  const h = harness();
  h.paused = true;
  h.q.enqueue(play('g1', 'run', { home_score: 4 }));
  h.q.enqueue(play('g2', 'run', { home_score: 1 }));
  h.paused = false;
  await h.q.drain();
  assert.deepEqual(h.sent.map((w) => [w.gameId, w.patch.home_score]), [['g1', 4], ['g2', 1]]);
});

test('pendingFor answers per game, and never for a missing id', async () => {
  const h = harness({ isPaused: () => true });
  h.q.enqueue(play('g1', 'ball'));
  assert.equal(h.q.pendingFor('g1'), true);
  assert.equal(h.q.pendingFor('g2'), false);
  assert.equal(h.q.pendingFor(null), false);
  assert.equal(h.q.pendingFor(undefined), false);
});

test('dropFor forgets one game and leaves the other queued', async () => {
  const h = harness({ isPaused: () => true });
  h.q.enqueue(play('g1', 'ball'));
  h.q.enqueue(play('g2', 'ball'));
  h.q.enqueue(play('g1', 'strike'));
  h.q.dropFor('g1');
  assert.equal(h.q.size(), 1);
  assert.deepEqual(h.q.entriesFor('g2').map((w) => w.type), ['ball']);
});

test('a field write and a play share one queue and keep their order', async () => {
  const h = harness();
  h.q.enqueue(field('g1', { theme: 'dusk' }));
  h.q.enqueue(play('g1', 'run', { home_score: 1 }));
  await h.q.drain();
  assert.deepEqual(h.sent.map((w) => w.kind), ['field', 'event']);
});

// ===========================================================================
// Stale stingers
// ===========================================================================
test('a stinger older than the stale window is dropped; the play still lands', async () => {
  const h = harness({ isPaused: () => true });
  h.q.enqueue(play('g1', 'run', { home_score: 1, current_animation: { type: 'run', nonce: 5 } }));
  h.clock += STALE_ANIM_MS + 1;
  h.io.isPaused = () => false;
  await h.q.drain();
  assert.equal(h.sent[0].patch.home_score, 1);
  assert.equal('current_animation' in h.sent[0].patch, false);
});

test('a stinger inside the window rides its own play out', async () => {
  const h = harness({ isPaused: () => true });
  h.q.enqueue(play('g1', 'run', { home_score: 1, current_animation: { type: 'run', nonce: 5 } }));
  h.clock += STALE_ANIM_MS - 1;
  h.io.isPaused = () => false;
  await h.q.drain();
  assert.equal(h.sent[0].patch.current_animation.type, 'run');
});

test('stripping the stinger does not mutate the queued entry', async () => {
  // It matters because a failed send leaves the entry in the queue to go again.
  const h = harness({ isPaused: () => true });
  const entry = play('g1', 'run', { home_score: 1, current_animation: { type: 'run', nonce: 5 } });
  h.q.enqueue(entry);
  h.clock += STALE_ANIM_MS + 1;
  h.error = { message: 'network' };
  h.io.isPaused = () => false;
  await h.q.drain();
  assert.equal(h.q.entriesFor('g1')[0].patch.current_animation.nonce, 5);
});

// ===========================================================================
// Failure, retry, recovery
// ===========================================================================
test('a rejection stops the drain, holds the queue, and schedules a retry', async () => {
  const h = harness();
  h.error = { message: 'Failed to fetch' };
  h.q.enqueue(play('g1', 'ball'));
  h.q.enqueue(play('g1', 'strike'));
  await h.q.drain();
  assert.equal(h.q.size(), 2);              // nothing accepted, nothing lost
  assert.equal(h.sent.length, 1);           // and it stopped at the first, in order
  assert.equal(h.retries, 1);
});

test('a lost network says so once, not on every retry', async () => {
  const h = harness();
  h.error = { message: 'Failed to fetch' };
  h.q.enqueue(play('g1', 'ball'));
  await h.q.drain();
  await h.fireRetry();
  await h.fireRetry();
  assert.deepEqual(h.toasts.map((t) => t[0]), ['⚠️ Not saved yet — Failed to fetch']);
});

test('the badge carries the reason while it is failing', async () => {
  const h = harness();
  h.error = { message: 'Failed to fetch' };
  h.q.enqueue(play('g1', 'ball'));
  await h.q.drain();
  assert.deepEqual(h.badges.at(-1), [1, 'Failed to fetch']);
});

test('recovery drains the backlog and confirms it out loud, once', async () => {
  const h = harness();
  h.error = { message: 'Failed to fetch' };
  h.q.enqueue(play('g1', 'ball'));
  h.q.enqueue(play('g1', 'strike'));
  await h.q.drain();
  h.error = null;
  await h.fireRetry();
  assert.equal(h.q.size(), 0);
  assert.deepEqual(h.toasts.map((t) => t[0]).at(-1), '✓ All changes saved');
  assert.equal(h.toasts.filter((t) => t[0] === '✓ All changes saved').length, 1);
});

test('a success with nothing before it stays quiet', async () => {
  const h = harness();
  h.q.enqueue(play('g1', 'ball'));
  await h.q.drain();
  assert.deepEqual(h.toasts, []);
});

test('a rejection that smells of a dead session says so separately', async () => {
  const h = harness();
  h.error = { message: 'JWT expired' };
  h.q.enqueue(play('g1', 'ball'));
  await h.q.drain();
  assert.deepEqual(h.authErrors, ['JWT expired']);
});

test('an ordinary network failure is not reported as an auth problem', async () => {
  const h = harness();
  h.error = { message: 'Failed to fetch' };
  h.q.enqueue(play('g1', 'ball'));
  await h.q.drain();
  assert.deepEqual(h.authErrors, []);
});

test('dropping the last queued write clears the failing state', async () => {
  // Otherwise the next unrelated failure, in a different game, stays silent.
  const h = harness();
  h.error = { message: 'Failed to fetch' };
  h.q.enqueue(play('g1', 'ball'));
  await h.q.drain();
  h.q.dropFor('g1');
  h.error = { message: 'Failed to fetch' };
  h.q.enqueue(play('g2', 'ball'));
  await h.q.drain();
  assert.equal(h.toasts.filter((t) => String(t[0]).startsWith('⚠️')).length, 2);
});

// ===========================================================================
// Pausing (the session expired mid-game)
// ===========================================================================
test('nothing is sent while there is no session, and nothing is lost', async () => {
  const h = harness({ isPaused: () => true });
  h.q.enqueue(play('g1', 'run', { home_score: 3 }));
  await h.q.drain();
  assert.deepEqual(h.sent, []);
  assert.equal(h.q.size(), 1);
});

test('signing back in sends exactly what was held', async () => {
  const h = harness();
  h.paused = true;
  h.q.enqueue(play('g1', 'run', { home_score: 3 }));
  h.q.enqueue(field('g1', { theme: 'dusk' }));
  h.paused = false;
  await h.q.drain();
  assert.deepEqual(h.sent.map((w) => w.kind), ['event', 'field']);
});

// ===========================================================================
// The baseline a local undo replays from
// ===========================================================================
test('the baseline advances on every accepted write, not only when empty', async () => {
  const h = harness();
  h.q.enqueue(play('g1', 'ball'));
  h.q.enqueue(play('g1', 'strike'));
  h.q.enqueue(play('g1', 'run'));
  await h.q.drain();
  assert.equal(h.q.baseline().v, 3);
});

test('the baseline is the last row the server confirmed, across games', async () => {
  const h = harness();
  h.q.enqueue(play('g1', 'ball'));
  await h.q.drain();
  assert.equal(h.q.baseline().id, 'g1');
  h.q.setBaseline({ id: 'g2', v: 0 });
  assert.equal(h.q.baseline().id, 'g2');
});

test('a failed write does not move the baseline', async () => {
  const h = harness();
  h.q.enqueue(play('g1', 'ball'));
  await h.q.drain();
  const at = h.q.baseline();
  h.error = { message: 'Failed to fetch' };
  h.q.enqueue(play('g1', 'strike'));
  await h.q.drain();
  assert.equal(h.q.baseline(), at);
});

test('the row is only settled once the queue has nothing left for that game', async () => {
  const h = harness();
  h.paused = true;
  h.q.enqueue(play('g1', 'ball'));
  h.q.enqueue(play('g1', 'strike'));
  h.q.enqueue(play('g2', 'ball'));
  h.paused = false;
  await h.q.drain();
  assert.deepEqual(h.accepted.map((a) => [a[1], a[2]]), [['g1', false], ['g1', true], ['g2', true]]);
});

// ===========================================================================
// Removing one entry (what a local undo does)
// ===========================================================================
test('drop removes exactly the entry handed to it', async () => {
  const h = harness({ isPaused: () => true });
  h.q.enqueue(play('g1', 'ball'));
  h.q.enqueue(play('g1', 'strike'));
  h.q.enqueue(play('g1', 'ball'));
  const mine = h.q.entriesFor('g1');
  assert.equal(h.q.drop(mine[2]), true);
  assert.deepEqual(h.q.entriesFor('g1').map((w) => w.type), ['ball', 'strike']);
});

test('drop picks the right one out of a queue holding another game', async () => {
  // entriesFor() is a filtered view, so an entry cannot be addressed by index.
  const h = harness({ isPaused: () => true });
  h.q.enqueue(play('g1', 'ball'));
  h.q.enqueue(play('g2', 'ball'));
  h.q.enqueue(play('g1', 'strike'));
  h.q.drop(h.q.entriesFor('g1')[1]);
  assert.deepEqual(h.q.entriesFor('g1').map((w) => w.type), ['ball']);
  assert.equal(h.q.pendingFor('g2'), true);
});

test('drop reports an entry it does not hold rather than removing something else', async () => {
  const h = harness({ isPaused: () => true });
  h.q.enqueue(play('g1', 'ball'));
  assert.equal(h.q.drop(play('g1', 'ball')), false);
  assert.equal(h.q.size(), 1);
});

test('clear empties the queue', async () => {
  const h = harness({ isPaused: () => true });
  h.q.enqueue(play('g1', 'ball'));
  h.q.enqueue(play('g2', 'ball'));
  h.q.clear();
  assert.equal(h.q.size(), 0);
  assert.deepEqual(h.badges.at(-1), [0, undefined]);
});

// ===========================================================================
// Re-entrancy — every one of these calls drain()
// ===========================================================================
test('a drain already running is not started twice', async () => {
  // 'online', visibilitychange, the retry timer and every enqueue all call it.
  const h = harness();
  let gate;
  const held = new Promise((r) => { gate = r; });
  let first = true;
  h.io.applyEvent = async (gameId, type, patch, payload) => {
    h.sent.push({ kind: 'event', gameId, type, patch, payload });
    if (first) { first = false; await held; }
    return { data: h.row(gameId), error: null };
  };
  h.q.enqueue(play('g1', 'ball'));
  h.q.drain(); h.q.drain();          // the tab came back, the network came back
  h.q.enqueue(play('g1', 'strike'));
  gate();
  await h.q.drain();
  assert.deepEqual(h.sent.map((w) => w.type), ['ball', 'strike']);
});

test('a write made mid-drain joins the back of the queue and still goes out', async () => {
  // Scoring does not stop while the queue is working through a backlog.
  const h = harness();
  h.io.applyEvent = async (gameId, type, patch, payload) => {
    h.sent.push({ kind: 'event', gameId, type, patch, payload });
    if (type === 'ball') h.q.enqueue(play('g1', 'run'));
    return { data: h.row(gameId), error: null };
  };
  h.q.enqueue(play('g1', 'ball'));
  await h.q.drain();
  assert.deepEqual(h.sent.map((w) => w.type), ['ball', 'run']);
  assert.equal(h.q.size(), 0);
});

test('awaiting drain() waits for a drain that is already running', async () => {
  // Everything hopeful calls drain(); if the second caller returned early the
  // queue would look idle while a write was still in the air.
  const h = harness();
  let gate;
  const held = new Promise((r) => { gate = r; });
  h.io.applyEvent = async (gameId, type, patch, payload) => {
    h.sent.push({ kind: 'event', gameId, type, patch, payload });
    await held;
    return { data: h.row(gameId), error: null };
  };
  h.q.enqueue(play('g1', 'ball'));
  const joined = h.q.drain();
  gate();
  await joined;
  assert.equal(h.q.size(), 0);
});

// ===========================================================================
// The boundary the extraction created
// ===========================================================================
test('a queue built with an incomplete io refuses to exist', () => {
  // control.js builds the queue as it evaluates, so a key renamed on one side
  // of this boundary breaks the page on load rather than the queue offline.
  const h = harness();
  for (const k of IO_KEYS) {
    const io = { ...h.io };
    delete io[k];
    assert.throws(() => createQueue(io), new RegExp(`io\\.${k} is required`), `missing ${k} went unnoticed`);
  }
});

test('now is optional and falls back to the real clock', async () => {
  const h = harness();
  delete h.io.now;
  const q = createQueue(h.io);
  q.enqueue(play('g1', 'ball'));
  await q.drain();
  assert.equal(h.sent.length, 1);
});
