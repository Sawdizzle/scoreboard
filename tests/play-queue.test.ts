// The pad's outbox against a fake database that drops the connection, loses
// replies and answers PB409, the way a phone at the field meets it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pumpQueue, type QueueIO, type QueueItem, type QueueState, type Sent } from '../lib/play-queue.ts';

// A game on the "server": its events, and a script of what goes wrong.
function fakeDb(start = 0) {
  const events: { seq: number; payload: { cid?: string }; undo?: boolean }[] = [];
  let seq = start;
  const faults: ('offline' | 'lost' | 'jwt' | 'hang')[] = [];
  let refreshed = 0, sends = 0;
  const apply = (it: QueueItem, at: number): Sent => {
    if (at !== seq) return { data: null, error: { code: 'PB409', message: 'The game moved on.' } };
    seq += 1;
    if (it.kind === 'play') events.push({ seq, payload: it.payload });
    else { events.pop(); }
    return { data: { seq }, error: null };
  };
  const io: QueueIO = {
    async send(it, at, signal) {
      sends += 1;
      const f = faults.shift();
      if (f === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch' } };
      if (f === 'jwt') return { data: null, error: { code: 'PGRST301', message: 'JWT expired' } };
      if (f === 'hang') {
        await new Promise((r) => signal.addEventListener('abort', r));
        return { data: null, error: { message: 'AbortError: signal is aborted' } };
      }
      const r = apply(it, at);
      // Saved on the server, but the reply never reached the phone.
      if (f === 'lost') return { data: null, error: { message: 'TypeError: Load failed' } };
      return r;
    },
    eventsAfter: async (at) => events.filter((e) => e.seq > at),
    gameSeq: async () => seq,
    hasEvent: async (at) => events.some((e) => e.seq === at),
    refresh: async () => { refreshed += 1; },
    sleep: async () => {},
    timeoutMs: 20,
  };
  return {
    io, events, faults,
    get seq() { return seq; }, set seq(v: number) { seq = v; },
    get refreshed() { return refreshed; }, get sends() { return sends; },
    // Another phone scores a play.
    other(cid = 'theirs') { seq += 1; events.push({ seq, payload: { cid } }); },
  };
}

const play = (cid: string): QueueItem => ({ kind: 'play', type: 'play', patch: {}, payload: { cid }, rows: [], status: null });
const state = (items: QueueItem[], seq = 0): QueueState => ({ items, seq, sentOnce: new WeakSet() });
const hooks = () => {
  const log: string[] = [];
  return { log, h: { status: (s: string) => { log.push(s); }, saved: () => { log.push('saved'); } } };
};

test('plays send in order and the seq follows the server', async () => {
  const db = fakeDb();
  const st = state([play('a'), play('b'), play('c')]);
  const { log, h } = hooks();
  const r = await pumpQueue(st, db.io, h);
  assert.deepEqual(r, { resync: false, failed: null });
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a', 'b', 'c']);
  assert.equal(st.seq, 3);
  assert.equal(st.items.length, 0);
  assert.equal(log.filter((x) => x === 'saved').length, 3);
});

test('no signal, a hung request and a lapsed sign-in: the play waits and goes through', async () => {
  const db = fakeDb();
  db.faults.push('offline', 'offline', 'hang', 'jwt');
  const st = state([play('a')]);
  const { log, h } = hooks();
  const r = await pumpQueue(st, db.io, h);
  assert.equal(r.failed, null);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a']);
  assert.equal(db.refreshed, 1);
  assert.equal(log.filter((x) => x === 'retry').length, 4);
});

test('a play that saved but whose reply was lost is not sent twice', async () => {
  const db = fakeDb();
  db.faults.push('lost');
  const st = state([play('a'), play('b')]);
  const r = await pumpQueue(st, db.io, hooks().h);
  // The retry of "a" meets PB409; the server's newer play carries a's id, so it is ours.
  assert.equal(r.failed, null);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a', 'b']);
  assert.equal(st.seq, 2);
});

test('plays kept on the phone after a closed tab: the ones that saved are skipped', async () => {
  const db = fakeDb();
  // Two of three saved before the tab closed; the phone kept all three from seq 0.
  await pumpQueue(state([play('a'), play('b')]), db.io, hooks().h);
  const st = state([play('a'), play('b'), play('c')], 0);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.equal(r.failed, null);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a', 'b', 'c']);
});

test('an undo whose reply was lost is counted as done, and asks for a resync', async () => {
  const db = fakeDb();
  db.other('x'); db.other('y');
  db.faults.push('lost');
  const st = state([{ kind: 'undo' }], 2);
  // The lost undo removed y and moved seq to 3; the retry sees PB409.
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.deepEqual(r, { resync: true, failed: null });
  assert.equal(st.seq, 3);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['x']);
});

test('another phone scored first: the queue is dropped and the pad is told how many', async () => {
  const db = fakeDb();
  db.other();
  const st = state([play('a'), play('b')], 0);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.equal(r.failed?.lost, 2);
  assert.equal(r.failed?.error.code, 'PB409');
  assert.equal(st.items.length, 0);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['theirs']);
});

test('a refused play (not a conflict) stops the queue too', async () => {
  const db = fakeDb();
  db.io.send = async () => ({ data: null, error: { code: '42501', message: 'Your seat cannot score this game.' } });
  const r = await pumpQueue(state([play('a')]), db.io, hooks().h);
  assert.deepEqual(r.failed, { lost: 1, error: { code: '42501', message: 'Your seat cannot score this game.' } });
});

// A phone waking from sleep: the call stalls before any request goes out (a
// sign-in refresh), so the abort signal never fires. The queue's own time
// limit must let go, or every later tap waits behind it until a force close.
test('a send that never answers, even to its abort signal, is retried', async () => {
  const db = fakeDb();
  let stalls = 1;
  const send = db.io.send.bind(db.io);
  db.io.send = (it, at, signal) => (stalls-- > 0 ? new Promise<Sent>(() => {}) : send(it, at, signal));
  db.io.timeoutMs = 5;
  const st = state([play('a')]);
  const { log, h } = hooks();
  const r = await pumpQueue(st, db.io, h);
  assert.equal(r.failed, null);
  assert.equal(st.items.length, 0);
  assert.equal(db.seq, 1);
  assert.ok(log.includes('retry'));
});

test('a stalled send that saved later is found by its id, not sent twice', async () => {
  const db = fakeDb();
  let first = true;
  const send = db.io.send.bind(db.io);
  // The first send lands on the server, but its answer never comes back.
  db.io.send = (it, at, signal) => {
    if (!first) return send(it, at, signal);
    first = false;
    void send(it, at, signal);
    return new Promise<Sent>(() => {});
  };
  db.io.timeoutMs = 5;
  const st = state([play('a'), play('b')]);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.equal(r.failed, null);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a', 'b']);
  assert.equal(st.seq, 2);
});

test('a conflict check that hangs or throws keeps the play and tries again', async () => {
  const db = fakeDb();
  db.faults.push('lost');
  let checks = 0;
  const after = db.io.eventsAfter.bind(db.io);
  db.io.eventsAfter = (at) => {
    checks += 1;
    if (checks === 1) return new Promise(() => {});
    if (checks === 2) return Promise.reject(new Error('TypeError: Load failed'));
    return after(at);
  };
  db.io.timeoutMs = 5;
  const st = state([play('a')]);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.equal(r.failed, null);
  assert.equal(st.items.length, 0);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a']);
  assert.ok(checks >= 3);
});

test('a lapsed sign-in whose refresh hangs does not hold the queue', async () => {
  const db = fakeDb();
  db.faults.push('jwt');
  db.io.refresh = () => new Promise(() => {});
  db.io.timeoutMs = 5;
  const st = state([play('a')]);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.equal(r.failed, null);
  assert.equal(db.seq, 1);
});

// ---- apply_plays: everything waiting in one request -------------------------
// The fake's apply_plays: all or nothing, like the transaction on the server.
// A play whose cid starts with "bad" is refused (a row the database rejects).
function batched(db: ReturnType<typeof fakeDb>) {
  const calls: number[] = [];
  const single = db.io.send.bind(db.io);
  db.io.send = async (it, at, signal) => {
    if (it.kind === 'play' && it.payload.cid?.startsWith('bad')) return { data: null, error: { code: 'P0001', message: 'That play could not be read.' } };
    return single(it, at, signal);
  };
  db.io.sendPlays = async (items, at) => {
    calls.push(items.length);
    const f = db.faults.shift();
    if (f === 'offline') return { data: null, error: { message: 'TypeError: Failed to fetch' } };
    if (at !== db.seq) return { data: null, error: { code: 'PB409', message: 'The game moved on.' } };
    if (items.some((it) => it.payload.cid?.startsWith('bad'))) return { data: null, error: { code: 'P0001', message: 'That play could not be read.' } };
    const results = items.map((it) => { db.seq += 1; db.events.push({ seq: db.seq, payload: it.payload }); return { seq: db.seq }; });
    if (f === 'lost') return { data: null, error: { message: 'TypeError: Load failed' } };
    return { data: { seq: db.seq, results }, error: null };
  };
  return calls;
}

test('plays waiting together go in one request, and each one is reported saved', async () => {
  const db = fakeDb();
  const calls = batched(db);
  const st = state([play('a'), play('b'), play('c')]);
  const { log, h } = hooks();
  const r = await pumpQueue(st, db.io, h);
  assert.deepEqual(r, { resync: false, failed: null });
  assert.deepEqual(calls, [3]);
  assert.equal(db.sends, 0);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a', 'b', 'c']);
  assert.equal(st.seq, 3);
  assert.equal(log.filter((x) => x === 'saved').length, 3);
});

test('an undo goes alone: plays before it batch, plays after it batch again', async () => {
  const db = fakeDb();
  const calls = batched(db);
  const st = state([play('a'), play('b'), { kind: 'undo' }, play('c'), play('d')]);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.equal(r.failed, null);
  assert.deepEqual(calls, [2, 2]);
  assert.equal(db.sends, 1);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a', 'c', 'd']);
  assert.equal(st.seq, 5);
});

test('a batch whose reply was lost is found by its ids and not sent twice', async () => {
  const db = fakeDb();
  const calls = batched(db);
  db.faults.push('offline', 'lost');
  const st = state([play('a'), play('b'), play('c')]);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.equal(r.failed, null);
  // Offline, then saved with the reply lost, then PB409 and the ids match.
  assert.deepEqual(calls, [3, 3, 3]);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a', 'b', 'c']);
  assert.equal(st.seq, 3);
  assert.equal(st.items.length, 0);
});

test('a batch on an old seq is refused whole: the queue drops as before', async () => {
  const db = fakeDb();
  batched(db);
  db.other();
  const st = state([play('a'), play('b')], 0);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.equal(r.failed?.lost, 2);
  assert.equal(r.failed?.error.code, 'PB409');
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['theirs']);
});

test('a bad play in a batch: the good ones before it still save, one at a time', async () => {
  const db = fakeDb();
  const calls = batched(db);
  const st = state([play('a'), play('b'), play('bad'), play('c')]);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.deepEqual(calls, [4]);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a', 'b']);
  assert.equal(r.failed?.lost, 2);
  assert.equal(r.failed?.error.code, 'P0001');
});

test('a server without apply_plays yet: the pad falls back to one play per request', async () => {
  const db = fakeDb();
  db.io.sendPlays = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.apply_plays' } });
  const st = state([play('a'), play('b')]);
  const r = await pumpQueue(st, db.io, hooks().h);
  assert.equal(r.failed, null);
  assert.equal(db.sends, 2);
  assert.deepEqual(db.events.map((e) => e.payload.cid), ['a', 'b']);
});
