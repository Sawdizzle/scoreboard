// The write queue: every durable change the pad makes, in order, and retried
// until the server takes it.
//
// This was ~90 lines in the middle of control.js sharing a module scope with
// auth, the lobby, OBS control and the drawer — and that shared scope is what
// made the cross-game corruption bug possible, because `drain()` could address
// a write to whatever game happened to be open when the network came back
// rather than to the game the write was made in.
//
// It is out here so it can be TESTED. The pad's queue is the path that carries
// every score, and it was also the least covered code in the project: exercising
// it in the browser needs a signed-in session and a dead network at the same
// time. Nothing here touches the DOM, the network, the clock or Supabase —
// every effect arrives through `io` — so scripts/sync.test.mjs can drive a lost
// connection, a stale stinger and two interleaved games in a few milliseconds.
//
// Deliberately no imports: scripts/load-module.mjs can only load a module with
// none, and being loadable by it is the whole point.
//
// What it carries, and what it must not:
//   kind 'event' — a play, through apply_event (snapshots prev_state, undoable)
//   kind 'field' — a direct games UPDATE: setup, look, audio, sponsors, cards
//   kind 'roster' — the whole lineup blob for a game, through save_roster. Only
//                   the newest one matters, so a roster queued behind another
//                   for the same game replaces it instead of queueing twice.
// Transient triggers stay OUT on purpose: replaying a stinger, a clip request,
// a scene cut or "go live" minutes late would fire it over the wrong moment of
// the game. Those are fire-and-forget by design, and always were.

// A stinger belongs to the moment it fired. Riding the play's own write makes it
// free, but it also means a write that sat in the queue would put HOME RUN on
// air over whatever is happening by the time the network returns. Past this age
// the play still lands; the stinger is dropped. Local elapsed time only — no
// clock comparison with any other device.
export const STALE_ANIM_MS = 10000;
export const RETRY_MS = 4000;
// A rejection that smells of expired credentials rather than a dead network.
const AUTH_ERROR = /jwt|token|401|not authenticated|unauthorized/i;

// io — the whole boundary. Everything is required except `now`.
//   applyEvent(gameId, type, patch, payload) -> {data, error}   the apply_event RPC
//   updateFields(gameId, patch)             -> {data, error}    a plain games UPDATE
//   saveRoster(gameId, lineups)             -> {data, error}    save_roster; data = the new roster_rev
//   onRosterSaved(gameId, rev, settled)  a roster landed; `settled` when no newer one is queued
//   onPending(count, errMessage)   the ⏳ badge; errMessage set only while failing
//   onAccepted(row, gameId, settled)  a write landed. `settled` is true when it
//                                     was the LAST one queued for that game, i.e.
//                                     the row is finally authoritative for it.
//   onToast(message, ms)           the one place this speaks to the operator
//   onAuthError(message)           the rejection looks like a dead session
//   isPaused()                     true while there is no session to write with
//   retry(fn, ms)                  schedule fn, REPLACING any retry already set
//   now()                          optional; Date.now by default, for the tests
// Named so the boundary can check itself. Extracting the queue traded one
// module scope for two files that have to agree, and a key renamed on one side
// would otherwise stay silent until the pad went offline mid-game. This throws
// at construction instead — which happens as control.js evaluates, so the page
// fails loudly on load rather than the queue misbehaving on a bad connection.
// `now` is deliberately not on the list: it defaults to Date.now.
export const IO_KEYS = ['applyEvent', 'updateFields', 'saveRoster', 'onPending', 'onAccepted',
  'onRosterSaved', 'onToast', 'onAuthError', 'isPaused', 'retry'];

export function createQueue(io) {
  for (const k of IO_KEYS) {
    if (typeof io[k] !== 'function') throw new Error(`createQueue: io.${k} is required`);
  }
  const pending = [];          // FIFO of {kind, gameId, patch, at, ...} not yet accepted
  let draining = false;
  let inflight = null;         // so drain() can be awaited to "the queue is idle"
  let failing = false;         // so a lost network toasts once, not every retry
  let sending = null;          // the entry on the wire, which a newer roster must not replace
  // The last row the server confirmed, and the base a local undo replays from.
  // It advances with each accepted write, NOT only when the queue empties.
  let baseline = null;
  const now = io.now || (() => Date.now());

  const badge = (err) => io.onPending(pending.length, err);

  // Every patch holds ABSOLUTE values, so the game it belongs to is part of the
  // write, not something to infer at send time. drain() can run long after you
  // have backed out to the lobby and opened something else.
  const pendingFor = (gameId) => !!gameId && pending.some((w) => w.gameId === gameId);
  const entriesFor = (gameId) => pending.filter((w) => w.gameId === gameId);

  function enqueue(entry) {
    if (entry.kind === 'roster') {
      // A roster is the whole thing, not a change to it: the newest waiting one
      // is all that needs to go. One already on the wire is left alone.
      const i = pending.findIndex((w) => w.kind === 'roster' && w.gameId === entry.gameId && w !== sending);
      if (i >= 0) { pending[i] = { ...entry, at: now() }; badge(); return drain(); }
    }
    pending.push({ ...entry, at: now() });
    badge();
    return drain();
  }

  // Everything hopeful calls this — enqueue, 'online', the tab coming back, the
  // retry timer, signing back in — so it must be safe to call at any moment.
  // A call made while one is already running joins it rather than starting a
  // second: awaiting drain() means "the queue is idle", which is what makes the
  // interleaving testable.
  function drain() {
    if (draining) return inflight || Promise.resolve();
    if (!pending.length) return Promise.resolve();   // no open game needed: the queue knows its own
    if (io.isPaused()) return Promise.resolve();     // nothing is accepted until there is a session
    draining = true;
    inflight = sendAll().finally(() => { draining = false; inflight = null; });
    return inflight;
  }

  // Strictly in order: each patch holds absolute values, so replaying them out
  // of sequence would undo later work.
  async function sendAll() {
    while (pending.length) {
      const w = pending[0];
      let patch = w.patch || {};
      if (patch.current_animation && now() - w.at > STALE_ANIM_MS) {
        patch = { ...patch };
        delete patch.current_animation;        // the play is still good; the stinger is not
      }
      sending = w;
      const { data, error } = w.kind === 'roster' ? await io.saveRoster(w.gameId, w.lineups)
        : w.kind === 'field' ? await io.updateFields(w.gameId, patch)
        : await io.applyEvent(w.gameId, w.type, patch, w.payload);
      sending = null;
      if (error) {
        badge(error.message);
        // Say it once. Silence here is what made a dropped Setup save invisible.
        if (!failing) { failing = true; io.onToast(`⚠️ Not saved yet — ${error.message}`, 4000); }
        if (AUTH_ERROR.test(error.message || '')) io.onAuthError(error.message);
        io.retry(drain, RETRY_MS);             // keep trying; the game doesn't stop
        return;
      }
      pending.shift();
      if (w.kind === 'roster') {
        io.onRosterSaved(w.gameId, data | 0, !pending.some((x) => x.kind === 'roster' && x.gameId === w.gameId));
        badge();
        continue;
      }
      // Each accepted write moves the baseline, even mid-queue: a local undo
      // replays what is STILL queued on top of this, so it has to be current.
      if (data) {
        baseline = data;
        io.onAccepted(data, w.gameId, !pendingFor(w.gameId));
      }
      badge();
    }
    if (failing) { failing = false; io.onToast('✓ All changes saved'); }
  }

  // Forget every queued write for one game — it is going away, or you chose to.
  function dropFor(gameId) {
    for (let i = pending.length - 1; i >= 0; i--) if (pending[i].gameId === gameId) pending.splice(i, 1);
    if (!pending.length) failing = false;
    badge();
  }

  // Drop one specific entry, by identity — the local undo picks the entry to
  // reverse out of entriesFor(), which may be a subset of a queue holding other
  // games' writes, so it cannot be addressed by index.
  function drop(entry) {
    const i = pending.indexOf(entry);
    if (i < 0) return false;
    pending.splice(i, 1);
    badge();
    return true;
  }

  function clear() {
    pending.length = 0;
    failing = false;
    badge();
  }

  return {
    enqueue, drain, dropFor, drop, clear,
    pendingFor, entriesFor,
    size: () => pending.length,
    baseline: () => baseline,
    setBaseline: (row) => { baseline = row; },
  };
}
