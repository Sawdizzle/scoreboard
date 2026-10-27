// The pad's outbox: plays and undos wait here, in order, until the database
// has each one. Shared by the baseball pad (Pad) and the other sports'
// ScorePad. No React and no Supabase in here: the pad hands in how to send
// and how to look things up (QueueIO), so tests can drop the connection.
//
//   * no signal, or a request that hangs past 15 s: keep the item, try again,
//     slower each time (up to 8 s apart)
//   * a sign-in that lapsed while the phone slept: renew it, try again
//   * PB409 (the game moved on): if the newer plays on the server carry our
//     own play ids, they are ours whose reply was lost; skip past them. An
//     undo whose reply was lost shows as the game one further on with no play
//     of that number. Anything else: drop the queue and say so.
//   * the queue is kept on the phone too (keep / readKept), so a reload or
//     iOS closing the tab does not lose plays that had not sent

export type QueueItem =
  | { kind: 'play'; type: string; patch: object; payload: { cid?: string } & Record<string, unknown>; rows: unknown[]; status: string | null }
  | { kind: 'undo' };
export type QueueError = { code?: string; message: string };
export type Sent = { data: unknown; error: QueueError | null };

export type QueueIO = {
  // apply_play or undo_play, on top of seq.
  send(item: QueueItem, seq: number, signal: AbortSignal): Promise<Sent>;
  // The server's events after seq, oldest first.
  eventsAfter(seq: number): Promise<{ seq: number; payload: unknown }[]>;
  gameSeq(): Promise<number | null>;
  hasEvent(seq: number): Promise<boolean>;
  refresh(): Promise<void>;
  sleep?(ms: number): Promise<void>;
  timeoutMs?: number;
};

// The queue's state, owned by the pad (its refs): the items, and the seq the
// first item goes on.
export type QueueState = { items: QueueItem[]; seq: number; sentOnce: WeakSet<QueueItem> };

export type QueueHooks = {
  // Sending, or waiting to retry, with this many items left.
  status(s: 'sending' | 'retry', waiting: number): void;
  // One item (or a run of ours found on the server) is saved; data is the
  // database's answer when there was one.
  saved(item: QueueItem, data: unknown): void;
};

export type PumpResult = { resync: boolean; failed: { lost: number; error: QueueError } | null };

export const newCid = () => (typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

const isOffline = (e: QueueError) => !e.code || /fetch|network|load failed|abort|timeout/i.test(e.message);
const isLapsed = (e: QueueError) => /PGRST30\d/.test(e.code ?? '') || /JWT/i.test(e.message);

export async function pumpQueue(st: QueueState, io: QueueIO, hooks: QueueHooks): Promise<PumpResult> {
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let wait = 800, resync = false;
  while (st.items.length) {
    hooks.status('sending', st.items.length);
    const it = st.items[0];
    const sentBefore = st.sentOnce.has(it);
    st.sentOnce.add(it);
    const { data, error } = await io.send(it, st.seq, AbortSignal.timeout(io.timeoutMs ?? 15000));
    if (!error) {
      st.seq = (data as { seq: number }).seq;
      st.items.shift();
      wait = 800;
      hooks.saved(it, data);
      continue;
    }
    if (isOffline(error) || isLapsed(error)) {
      hooks.status('retry', st.items.length);
      if (isLapsed(error)) await io.refresh().catch(() => {});
      await sleep(wait);
      wait = Math.min(wait * 2, 8000);
      continue;
    }
    if (error.code === 'PB409' && it.kind === 'play' && it.payload.cid) {
      const evs = await io.eventsAfter(st.seq);
      let n = 0, last = st.seq;
      for (const ev of evs) {
        const q = st.items[n];
        if (q?.kind !== 'play' || !q.payload.cid || (ev.payload as { cid?: string } | null)?.cid !== q.payload.cid) { n = -1; break; }
        n += 1; last = ev.seq;
      }
      if (n > 0) {
        st.seq = last;
        const ours = st.items.splice(0, n);
        wait = 800;
        hooks.saved(ours[ours.length - 1], null);
        continue;
      }
    }
    if (error.code === 'PB409' && it.kind === 'undo' && sentBefore) {
      const now = await io.gameSeq();
      if (now !== null && now === st.seq + 1 && !(await io.hasEvent(now))) {
        st.seq = now;
        st.items.shift();
        wait = 800;
        resync = true;
        hooks.saved(it, null);
        continue;
      }
    }
    const lost = st.items.length;
    st.items.splice(0);
    return { resync, failed: { lost, error } };
  }
  return { resync, failed: null };
}

// The queue as kept on the phone: the seq the first item goes on, and the items.
export type Kept<T extends QueueItem = QueueItem> = { seq: number; items: T[] };
export const keepKey = (gameId: string) => `pad-queue:${gameId}`;

export function keep(gameId: string, st: Pick<QueueState, 'items' | 'seq'>) {
  try {
    if (st.items.length) localStorage.setItem(keepKey(gameId), JSON.stringify({ seq: st.seq, items: st.items } satisfies Kept));
    else localStorage.removeItem(keepKey(gameId));
  } catch { /* private mode or full: the queue still runs in memory */ }
}

export function readKept<T extends QueueItem = QueueItem>(gameId: string): Kept<T> | null {
  try {
    const k = JSON.parse(localStorage.getItem(keepKey(gameId)) ?? 'null') as Kept<T> | null;
    return k && Array.isArray(k.items) && k.items.length ? k : null;
  } catch { return null; }
}
