'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { OnAir, type Channel } from '@/components/pad/OnAir';
import { airTopic } from '@/components/overlay/Overlay';
import { GameClock } from '@/components/pad/GameClock';
import { AtBat, EndCheck, EndGame, GameMenu, InPlay, Pitching, PitchMenu, Runner, Situation, type BatterFix, type InPlayResult, type NewKid } from '@/components/pad/PadSheets';
import { FieldView, type Drop } from '@/components/pad/FieldView';
import { PitchCounts, PlaysSheet, type Log } from '@/components/pad/PlaysSheet';
import { Decisions, type Decided, type Picks } from '@/components/pad/Decisions';
import { addRosterPlayer, editBatter, saveLineup } from '@/app/actions';
import { auditGame, type Issue } from '@/lib/audit';
import type { SummaryEvent, SummaryStat } from '@/lib/summarize';
import type { LogEvent, LogStat } from '@/lib/plays';
import { brandOf, opponentBrand, TeamMark } from '@/components/TeamBrand';
import * as L from '@/lib/rules/logic.js';
import { assignSpot, newBid, normalizeTeam, positionOf } from '@/lib/rules/roster.js';
import { engineGame, gameOver, lastPlayText, onPlay, orderChange, pitcherChange, record, runnersOf, sideOf, tonight, type EngineSide, type Res, type StatKey, type StatRow } from '@/lib/scoring';
import { mergeBroadcast, type Broadcast, type BroadcastPatch } from '@/lib/broadcast';
import { airView } from '@/lib/onair';
import { shortName } from '@/lib/format';
import type { SeasonLine } from '@/lib/stats';
import { browserClient } from '@/lib/supabase/browser';
import { CONSOLE, useMedia } from '@/lib/use-media';
import type { FormState, Game, Lineup, LineupBatter, Side, Team } from '@/lib/types';

type Line = Partial<Record<StatKey, number>>;
type Status = Game['status'];
type Item = { kind: 'play'; type: string; patch: object; payload: { cid?: string } & Record<string, unknown>; rows: StatRow[]; status: Status | null } | { kind: 'undo' };
// The queue as kept on the phone: the seq the first item goes on, and the items.
type Kept = { seq: number; items: Item[] };
const keepKey = (gameId: string) => `pad-queue:${gameId}`;
const cid = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const readKept = (gameId: string): Kept | null => {
  try { const k = JSON.parse(localStorage.getItem(keepKey(gameId)) ?? 'null') as Kept | null; return k && Array.isArray(k.items) && k.items.length ? k : null; } catch { return null; }
};

// The pad's two layouts, remembered on this phone: the field (GameChanger's
// way, the default) or big keys (the pad before it, for a scorer who wants it).
type Layout = 'field' | 'keys';
const LAYOUT_KEY = 'pad-layout';
const readLayout = (): Layout => { try { return localStorage.getItem(LAYOUT_KEY) === 'keys' ? 'keys' : 'field'; } catch { return 'field'; } };
const onLayout = (cb: () => void) => { window.addEventListener('storage', cb); window.addEventListener(LAYOUT_KEY, cb); return () => { window.removeEventListener('storage', cb); window.removeEventListener(LAYOUT_KEY, cb); }; };
const setLayout = (l: Layout) => { try { localStorage.setItem(LAYOUT_KEY, l); } catch { /* private mode: this visit only */ } window.dispatchEvent(new Event(LAYOUT_KEY)); };
// Sunlight: the pad in high contrast, black on white, for a bright day at the
// field. Kept per phone, like the layout.
type Theme = 'dark' | 'sun';
const THEME_KEY = 'pad-theme';
const readTheme = (): Theme => { try { return localStorage.getItem(THEME_KEY) === 'sun' ? 'sun' : 'dark'; } catch { return 'dark'; } };
const onTheme = (cb: () => void) => { window.addEventListener('storage', cb); window.addEventListener(THEME_KEY, cb); return () => { window.removeEventListener('storage', cb); window.removeEventListener(THEME_KEY, cb); }; };
const setTheme = (t: Theme) => { try { localStorage.setItem(THEME_KEY, t); } catch { /* private mode: this visit only */ } window.dispatchEvent(new Event(THEME_KEY)); };
// Our result from the score, for the pitching decisions.
const resultFor = (g: { home_score?: number | null; away_score?: number | null }, home: boolean) => {
  const us = (home ? g.home_score : g.away_score) ?? 0, them = (home ? g.away_score : g.home_score) ?? 0;
  return us > them ? 'won' as const : us < them ? 'lost' as const : 'tied' as const;
};

// A team's name in the header: the whole of it where it fits, its
// abbreviation where it does not (two long names on a phone).
function TeamName({ full, short }: { full: string; short: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const whole = useRef<HTMLSpanElement>(null);
  const [tight, setTight] = useState(false);
  const can = !!short && short.toUpperCase() !== full.toUpperCase();
  useEffect(() => {
    const b = box.current, w = whole.current;
    if (!b || !w || !can) return;
    const check = () => setTight(w.scrollWidth > b.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(b);
    void document.fonts?.ready.then(check);
    return () => ro.disconnect();
  }, [full, can]);
  const cut = can && tight;
  return (
    <span className={`pad-name${cut ? ' cut' : ''}`} ref={box}>
      <span className="pad-name-full" ref={whole} aria-hidden={cut || undefined}>{full}</span>
      {cut && <span className="pad-name-short">{short}</span>}
    </span>
  );
}

// Our batters keep the names the server put in the team's format; a lineup
// read straight from the table has the names it was saved with.
function sameNames(fresh: Lineup | undefined, named: Lineup | undefined) {
  if (!fresh || !named) return fresh;
  const by = new Map((named.batters ?? []).map((b) => [b.bid, b]));
  return { ...fresh, batters: (fresh.batters ?? []).map((b) => { const n = by.get(b.bid); return n ? { ...b, num: n.num, name: n.name } : b; }) };
}
type Sheet = null | 'atbat' | 'inplay' | 'dropped' | 'pitch' | 'menu' | 'situation' | 'air' | 'check' | 'end' | 'pitching' | 'plays' | 'decide'
  | { runner: 'first' | 'second' | 'third'; drop?: Drop };

const addRows = (t: Record<string, Line>, rows: StatRow[], sign = 1) => {
  const out = { ...t };
  for (const r of rows) {
    const line: Line = { ...(out[r.bid] ?? {}) };
    for (const [k, v] of Object.entries(r)) if (typeof v === 'number') line[k as StatKey] = (line[k as StatKey] ?? 0) + sign * v;
    out[r.bid] = line;
  }
  return out;
};
export const sumRows = (rows: StatRow[]) => addRows({}, rows);

// The scoring pad. Scoreboard's pad, rebuilt on Scoreboard's lineups: BALL,
// STRIKE, FOUL and IN PLAY for the pitch; MORE for the rare ones; the runners
// on the diamond for steals; the bar above for corrections; End game on the
// bottom bar, and offered by itself when the score says the game is over.
// The pitcher (tap his pitch count) and a sub (the At the plate sheet) change
// here too, without leaving the pad.
//
// Every tap is applied here at once (the rules run in the browser) and queued
// for the database in order. A dropped connection only delays the queue; a
// play from another phone in between makes this pad reload rather than write
// over it.
export function Pad({ slug, team, game, lineups, season, tonightRows, regulation, canScore, canWrite = false, channel, roster = [], bench = [], canRoster = false, openEnd = false, log, decided }: {
  slug: string; team: Team; game: Game & { seq: number }; lineups: Partial<Record<Side, Lineup>>;
  season: SeasonLine[]; tonightRows: StatRow[]; regulation: number; canScore: boolean; canWrite?: boolean; channel: Channel | null;
  // Our players' first and last names, for fixing a name from the pad.
  roster?: { id: string; first_name: string; last_name: string }[];
  // Our active roster as batters, for a sub: whoever is not in the order is on the bench.
  bench?: LineupBatter[];
  // This seat can add a kid to the roster (organizer, head coach).
  canRoster?: boolean;
  // Open on End game (a game left live from an earlier day).
  openEnd?: boolean;
  // The game's log, for the component sheet (/dev/kit), which has no database:
  // the pad reads it from game_events and game_stats otherwise.
  log?: Log;
  // The pitching decisions as worked out, for the kit too (game_decisions otherwise).
  decided?: Picks;
}) {
  const sb = browserClient();
  const sides = useCallback((e: EngineSide) => sideOf(game, e), [game]);
  // The lineups as last read. The page's own copy can be stale (a phone's Back
  // button shows the pad from the router's cache, from before a lineup edit),
  // so every reload reads them again.
  const lineupsNow = useRef(lineups);
  // Our batters under their roster names: a name fixed from the pad replaces it here.
  const named = useRef(lineups.us);
  const rosterBy = useRef(new Map(roster.map((p) => [p.id, { first: p.first_name ?? '', last: p.last_name ?? '' }])));
  const [view, setView] = useState(() => ({
    g: engineGame(game, lineups, regulation), status: game.status as Status,
    tonight: sumRows(tonightRows), last: '',
    // The newest play ended a half: the stream's mid-inning board is up for it.
    rolled: false as boolean,
  }));
  const cur = useRef(view);
  const history = useRef<{ before: typeof view; rows: StatRow[] }[]>([]);
  const queue = useRef<Item[]>([]);
  const sending = useRef(false);
  const seq = useRef(game.seq);
  const [sync, setSync] = useState<'ok' | 'sending' | 'retry'>('ok');
  const [sheet, setSheet] = useState<Sheet>(openEnd && canScore && game.status === 'live' ? 'end' : null);
  // A tablet or bigger keeps On Air open as a console beside the keys.
  const wide = useMedia(CONSOLE);
  const [toast, setToast] = useState<{ text: string; act?: { label: string; run: () => void } } | null>(null);
  // "Not yet" on the game-over offer: hidden until the next half.
  const [overOff, setOverOff] = useState('');
  const [waiting, setWaiting] = useState(0);
  const [online, setOnline] = useState(true);
  const [chan, setChan] = useState(channel);
  const chanNow = useRef(chan);
  useEffect(() => { chanNow.current = chan; }, [chan]);
  // A hit typed on the keyboard (1, 2, 3, E) opens In Play at the fielder step.
  const [startKind, setStartKind] = useState<string | null>(null);
  // The stream's page listens here: a nudge after each save, so the scorebug
  // moves with the tap instead of at its next poll.
  const wire = useRef<ReturnType<typeof sb.channel> | null>(null);
  const nudge = useCallback(() => { void wire.current?.send({ type: 'broadcast', event: 'tick', payload: {} }); }, []);
  const token = channel?.token;
  // Another phone on this game nudges the same channel after each save; with
  // nothing of ours waiting, take its plays (a pad left open does not go stale).
  const follow = useRef<() => void>(() => {});
  useEffect(() => {
    if (!token) return;
    const c = sb.channel(airTopic(token)).on('broadcast', { event: 'tick' }, () => follow.current()).subscribe();
    wire.current = c;
    return () => { wire.current = null; void sb.removeChannel(c); };
  }, [sb, token]);

  const show = (v: typeof view) => { cur.current = v; setView(v); };
  const say = (text: string, act?: { label: string; run: () => void }) => {
    const t = { text, act };
    setToast(t);
    window.setTimeout(() => setToast((x) => (x === t ? null : x)), act ? 6000 : 3500);
  };

  // Taps since the last reload started: a reload that answers after a tap
  // would show the game from before it, so it stands down.
  const taps = useRef(0);
  // Saves the server confirmed: a reload that read the game before one of
  // them landed is older than what this pad knows.
  const acks = useRef(0);
  const [clock, setClock] = useState(game.clock ?? null);
  const catchUp = useRef<() => void>(() => {});
  // After a reload the pad has no history to tell whether the newest play ended
  // a half, so a fresh half (no outs, no count, nobody on) stands in for it,
  // unless the board was already taken down for this play.
  const freshHalf = (gg: typeof view.g, at: number) => {
    const bb = L.safeBases(gg.bases);
    const off = chanNow.current?.broadcast?.mid_off;
    return !(gg.outs | 0) && !(gg.balls | 0) && !(gg.strikes | 0) && !bb.first && !bb.second && !bb.third
      && !(off?.game === game.id && off.seq === at);
  };
  const reload = useCallback(async (after = true): Promise<boolean> => {
    const mark = taps.current, acked = acks.current;
    const [{ data: row }, { data: stats }, { data: lus, error: lusError }] = await Promise.all([
      sb.from('games').select('live, status, seq, clock').eq('id', game.id).single(),
      sb.from('game_stats').select('*').eq('game_id', game.id),
      sb.from('game_lineups').select('side, data').eq('game_id', game.id),
    ]);
    if (!row || mark !== taps.current || acked !== acks.current) return false;
    setClock(row.clock ?? null);
    if (!lusError && lus) {
      const got: Partial<Record<Side, Lineup>> = {};
      for (const r of lus as { side: Side; data: Lineup }[]) got[r.side] = r.data;
      got.us = sameNames(got.us, named.current);
      lineupsNow.current = got;
    }
    seq.current = row.seq;
    history.current = [];
    const fresh = engineGame({ ...game, live: row.live, status: row.status }, lineupsNow.current, regulation);
    show({ g: fresh, status: row.status, tonight: sumRows((stats ?? []) as StatRow[]), last: cur.current.last, rolled: freshHalf(fresh, row.seq) });
    if (after) catchUp.current();
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sb, game, lineups, regulation]);

  // The queue is kept on the phone as well, so a reload, a crash or iOS
  // closing the tab in the background does not lose plays that had not sent.
  const keep = useCallback(() => {
    try {
      if (queue.current.length) localStorage.setItem(keepKey(game.id), JSON.stringify({ seq: seq.current, items: queue.current } satisfies Kept));
      else localStorage.removeItem(keepKey(game.id));
    } catch { /* private mode or full: the queue still runs in memory */ }
  }, [game.id]);

  const pumpRef = useRef<() => Promise<void>>(async () => {});
  // When Game over was tapped (0: not asked), for the pitching decisions after it saves.
  const askDecide = useRef(0);
  // Items already sent once: a conflict on a second try may be our own lost save.
  const sentOnce = useRef(new WeakSet<Item>());
  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    let wait = 800, resync = false;
    while (queue.current.length) {
      setSync('sending');
      setWaiting(queue.current.length);
      const it = queue.current[0];
      const sent = !!sentOnce.current.has(it);
      sentOnce.current.add(it);
      // A request that hangs on bad signal is given up after 15 s and sent again.
      const stop = AbortSignal.timeout(15000);
      const { data, error } = it.kind === 'play'
        ? await sb.rpc('apply_play', { p_game: game.id, p_seq: seq.current, p_type: it.type, p_patch: it.patch, p_payload: it.payload, p_stats: it.rows, p_status: it.status }).abortSignal(stop)
        : await sb.rpc('undo_play', { p_game: game.id, p_seq: seq.current }).abortSignal(stop);
      if (error) {
        const offline = !error.code || /fetch|network|load failed|abort/i.test(error.message);
        // A sign-in that lapsed while the phone was asleep or offline: renew it and go again.
        const lapsed = /PGRST30\d/.test(error.code ?? '') || /JWT/i.test(error.message);
        if (offline || lapsed) {
          // Bad signal at the field: keep the play and try again, slower each time.
          setSync('retry');
          if (lapsed) await sb.auth.refreshSession().catch(() => {});
          await new Promise((r) => setTimeout(r, wait));
          wait = Math.min(wait * 2, 8000);
          continue;
        }
        // Plays of ours that saved without our hearing back (the signal dropped
        // after the server saved one, or the tab closed mid-send) look like
        // another phone's plays: anything newer on the server that carries our
        // own play ids is ours, and the queue goes on after them.
        if (error.code === 'PB409' && it.kind === 'play' && it.payload.cid) {
          const { data: evs } = await sb.from('game_events').select('seq, payload').eq('game_id', game.id).gt('seq', seq.current).order('seq');
          let n = 0, last = seq.current;
          for (const ev of evs ?? []) {
            const q = queue.current[n];
            if (q?.kind !== 'play' || !q.payload.cid || (ev.payload as { cid?: string } | null)?.cid !== q.payload.cid) { n = -1; break; }
            n += 1; last = ev.seq as number;
          }
          if (n > 0) {
            seq.current = last;
            acks.current += 1;
            queue.current.splice(0, n);
            keep();
            wait = 800;
            nudge();
            continue;
          }
        }
        // An undo whose reply was lost: it saved if the game moved on by one
        // with no play of that number (another phone's play would add one).
        if (error.code === 'PB409' && it.kind === 'undo' && sent) {
          const { data: g2 } = await sb.from('games').select('seq').eq('id', game.id).single();
          const { data: other } = g2 && g2.seq === seq.current + 1
            ? await sb.from('game_events').select('id').eq('game_id', game.id).eq('seq', g2.seq).maybeSingle()
            : { data: { id: 0 } };
          if (g2 && !other) {
            seq.current = g2.seq;
            acks.current += 1;
            queue.current.shift();
            keep();
            wait = 800;
            nudge();
            resync = true;
            continue;
          }
        }
        const lost = queue.current.length;
        queue.current = [];
        keep();
        await reload();
        const what = lost > 1 ? `${lost} plays did not save` : 'That play did not save';
        say(error.code === 'PB409' ? `Another phone scored a play. ${what}; reloaded the game.` : error.message || `${what}. Reloaded the game.`);
        break;
      }
      seq.current = (data as { seq: number }).seq;
      acks.current += 1;
      queue.current.shift();
      keep();
      wait = 800;
      nudge();
    }
    sending.current = false;
    setSync('ok');
    setWaiting(0);
    // Game over saved: ask for the pitching decisions, as GameChanger does,
    // unless the scorer has moved on (another sheet open, or a minute gone).
    if (!queue.current.length && askDecide.current) {
      const asked = askDecide.current;
      askDecide.current = 0;
      if (Date.now() - asked < 60000 && cur.current.status === 'final' && resultFor(cur.current.g, game.is_home) !== 'tied') setSheet((s) => s ?? 'decide');
    }
    // A tap made while a conflict reloaded the game: send it too.
    if (queue.current.length) window.setTimeout(() => void pumpRef.current(), 0);
    // After a lost undo the screen may not show what the server undid: catch up.
    else if (resync) void reload();
  }, [sb, game.id, game.is_home, reload, nudge, keep]);
  useEffect(() => { pumpRef.current = pump; }, [pump]);

  // Catch up with the server when it is safe to: nothing of ours waiting.
  const idle = () => !queue.current.length && !sending.current;
  useEffect(() => { follow.current = () => { if (!queue.current.length && !sending.current) void reload(); }; });
  useEffect(() => {
    const back = () => {
      setOnline(navigator.onLine);
      if (document.hidden) return;
      if (idle()) void reload(); else void pump();
    };
    const off = () => setOnline(false);
    document.addEventListener('visibilitychange', back);
    window.addEventListener('online', back);
    window.addEventListener('offline', off);
    return () => { document.removeEventListener('visibilitychange', back); window.removeEventListener('online', back); window.removeEventListener('offline', off); };
  }, [reload, pump]);

  // Keep the screen on while the pad is open: a phone that sleeps mid-inning
  // drops the connection and costs taps. Not every browser allows it.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const take = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl && !document.hidden) lock = await wl.request('screen');
      } catch { /* low battery or not allowed: the pad works without it */ }
    };
    void take();
    const again = () => { if (!document.hidden) void take(); };
    document.addEventListener('visibilitychange', again);
    return () => { document.removeEventListener('visibilitychange', again); void lock?.release().catch(() => {}); };
  }, []);

  // Record a play: here at once, then to the database in order.
  function commit(res: unknown, status: Status | null = null) {
    if (!canScore) return;
    const before = cur.current;
    const r = record(before.g, res as Res | null, sides);
    if (!r) return;
    history.current.push({ before, rows: r.rows });
    const nextStatus: Status = status ?? (before.status === 'scheduled' ? 'live' : before.status);
    taps.current += 1;
    show({ g: r.next, status: nextStatus, tonight: addRows(before.tonight, r.rows), last: lastPlayText(r.res, before.g, r.next),
      rolled: r.next.half !== before.g.half || r.next.inning !== before.g.inning });
    // `at`: when it was tapped, so a game video's chapters line up even if the play sent later.
    // `cid`: this tap's own id, to tell whether it saved when the answer was lost.
    queue.current.push({ kind: 'play', type: r.res.type, patch: r.patch, payload: { ...(r.res.payload ?? {}), at: new Date().toISOString(), cid: cid() }, rows: r.rows, status });
    keep();
    if (navigator.vibrate) navigator.vibrate(12);
    setSheet(null);
    void pump();
  }

  function undo() {
    if (!canScore) return;
    const h = history.current.pop();
    // Nothing to undo on screen (after a reload): the server undoes it, and a
    // second tap while that is on its way would undo another play.
    if (!h && queue.current.some((q) => q.kind === 'undo')) { say('Undoing… wait for it to save.'); return; }
    taps.current += 1;
    if (h) show({ ...h.before, last: `Undone: ${cur.current.last || 'last play'}` });
    else say('Undoing…');
    queue.current.push({ kind: 'undo' });
    keep();
    void pump().then(() => { if (!h) void reload(); });
  }

  // Put a batter at the plate by hand: the order was wrong (a tap that should
  // not have ended the at-bat, a lineup set late). The count stays: this is a
  // correction, and the order goes on from them.
  function pickBatter(i: number) {
    const g0 = cur.current.g;
    const side = L.battingSide(g0) as EngineSide;
    const b = g0.lineups[side]?.batters?.[i];
    if (!b) return;
    const batIdx = { ...((g0.state?.batIdx as object) ?? {}), [side]: i };
    commit({ type: 'batidx', text: `At the plate: ${b.num ? `#${b.num} ` : ''}${b.name || ''}`.trim(), patch: { state: { ...g0.state, batIdx } }, payload: { side, i } });
  }

  // A batter's number or name fixed from the pad: saved (to the roster for our
  // own players), then shown here and on the stream at once.
  async function saveBatter(e: EngineSide, bid: string, fix: BatterFix): Promise<string | null> {
    const side = sides(e);
    let r: Awaited<ReturnType<typeof editBatter>>;
    try { r = await editBatter(slug, game.id, side, bid, fix); } catch { return 'That did not save. Check the signal and try again.'; }
    if ('error' in r) return r.error;
    const nb = r.batter;
    const swap = (l: Lineup | undefined) => l && { ...l, batters: (l.batters ?? []).map((x) => (x.bid === bid ? nb : x)) };
    lineupsNow.current = { ...lineupsNow.current, [side]: swap(lineupsNow.current[side]) };
    if (side === 'us') {
      named.current = swap(named.current);
      if (fix.first !== undefined || fix.last !== undefined) rosterBy.current.set(bid, { first: (fix.first ?? '').trim(), last: (fix.last ?? '').trim() });
    }
    const v = cur.current;
    show({ ...v, g: { ...v.g, lineups: { ...v.g.lineups, [e]: swap(v.g.lineups[e]) } } as typeof v.g });
    nudge();
    say(`Saved: ${nb.num ? `#${nb.num} ` : ''}${nb.name}`.trim());
    return null;
  }

  // A lineup changed from the pad itself (a pitching change, a sub): saved
  // whole, shown at once, then the pitch count and the order catch up the way
  // they do after an edit on the lineup screen.
  async function saveSide(e: EngineSide, next: Lineup): Promise<string | null> {
    if (!canScore) return 'Your seat cannot change lineups.';
    const side = sides(e);
    const fd = new FormData();
    fd.set('lineup', JSON.stringify(next));
    let r: FormState;
    try { r = await saveLineup(slug, game.id, side, {}, fd); } catch { return 'That did not save. Check the signal and try again.'; }
    if (r.error) return r.error;
    lineupsNow.current = { ...lineupsNow.current, [side]: next };
    if (side === 'us') named.current = next;
    const v = cur.current;
    show({ ...v, g: { ...v.g, lineups: { ...v.g.lineups, [e]: next } } as typeof v.g });
    catchUp.current();
    nudge();
    return null;
  }
  const lineupOf = (e: EngineSide) => normalizeTeam(cur.current.g.lineups[e] ?? { batters: [], positions: {} }) as Lineup;
  const who = (b: LineupBatter | undefined) => (b ? `${b.num ? `#${b.num} ` : ''}${b.name || ''}`.trim() : '');

  // A new pitcher: one already in the order takes the mound, and the one
  // coming off takes his old spot (kids rotate). A number typed in (their
  // pitcher was never on the card) joins the end of the order.
  async function changePitcher(e: EngineSide, pick: { bid: string } | { num: string }): Promise<string | null> {
    let t = lineupOf(e);
    let i: number;
    if ('bid' in pick) i = t.batters.findIndex((b) => b.bid === pick.bid);
    else { t = normalizeTeam({ ...t, batters: [...t.batters, { bid: newBid(), num: pick.num, name: '' }] }) as Lineup; i = t.batters.length - 1; }
    if (i < 0) return 'That player is not in the lineup any more.';
    const err = await saveSide(e, assignSpot(t, 'P', i).team as Lineup);
    if (!err) say(`Now pitching: ${who(t.batters[i])}`);
    return err;
  }

  // A sub bats in the slot of the player he replaces and takes his spot in
  // the field; the one coming out goes to the bench.
  async function subIn(e: EngineSide, i: number, kid: LineupBatter | NewKid): Promise<string | null> {
    let b: LineupBatter;
    if ('bid' in kid) b = kid;
    else if (sides(e) === 'us' && kid.roster) {
      let r: Awaited<ReturnType<typeof addRosterPlayer>>;
      try { r = await addRosterPlayer(slug, { number: kid.num, first: kid.first, last: kid.last }); } catch { return 'That did not save. Check the signal and try again.'; }
      if ('error' in r) return r.error;
      b = r.batter;
    } else b = { bid: newBid(), num: kid.num, name: `${kid.first} ${kid.last}`.trim() };
    const t = lineupOf(e);
    const out = t.batters[i];
    if (!out) return 'That spot is empty.';
    if (t.batters.some((x) => x.bid === b.bid)) return `${who(b)} is already in the order.`;
    const positions = Object.fromEntries(Object.entries(t.positions).map(([pos, bid]) => [pos, bid === out.bid ? b.bid : bid]));
    const next = normalizeTeam({ ...t, batters: t.batters.map((x, j) => (j === i ? b : x)), positions }) as Lineup;
    const err = await saveSide(e, next);
    if (!err) say(`${who(b)} in for ${who(out)}`);
    return err;
  }

  // A pinch runner (who also takes the runner's place in the order) or a
  // courtesy runner (only on the bases), on the base that was tapped.
  async function runnerSub(from: 'first' | 'second' | 'third', kind: 'PR' | 'CR', kid: LineupBatter | { num: string; name: string }) {
    const e = L.battingSide(cur.current.g) as EngineSide;
    const b: LineupBatter = 'bid' in kid ? kid : { bid: newBid(), num: kid.num, name: kid.name };
    if (kind === 'PR') {
      const outBid = runnersOf(cur.current.g)[from];
      const i = outBid ? lineupOf(e).batters.findIndex((x) => x.bid === outBid) : -1;
      if (i >= 0) {
        const err = await subIn(e, i, b);
        if (err) { say(err); return; }
      }
    }
    commit(L.onRunnerSub(cur.current.g, from, kind, b.bid));
    setSheet(null);
  }

  // The log, read when the Plays sheet or the pitch counts open: each event's
  // inning and play note, and the stat rows that say who got what.
  const loadLog = useCallback(async (): Promise<Log | null> => {
    if (log) return log;
    const [ev, st] = await Promise.all([
      sb.from('game_events').select('id, seq, type, payload, inning:prev_live->inning, half:prev_live->>half').eq('game_id', game.id).order('seq'),
      sb.from('game_stats').select('event_id, side, bid, b_pa, b_r, b_sb, b_cs, b_pik, b_rbi, p_pitches, p_bf, p_outs, f_po, f_a, f_e, c_pik').eq('game_id', game.id),
    ]);
    if (ev.error || st.error) return null;
    const events = (ev.data ?? []) as unknown as (Omit<LogEvent, 'prev_live'> & { inning: number | null; half: 'top' | 'bottom' | null })[];
    return {
      events: events.map(({ inning, half, ...e }) => ({ ...e, prev_live: { inning: inning ?? undefined, half: half ?? undefined } })),
      stats: (st.data ?? []) as LogStat[],
    };
  }, [sb, game.id, log]);
  // A fix that did not save, said the way the rest of the pad says it.
  const editError = (error: { message?: string; code?: string }) =>
    !error.code || /fetch|network|load failed/i.test(error.message ?? '') ? 'No signal: that did not save. Try again.' : error.message || 'That did not save. Try again.';
  // Anyone's name by id: either lineup, or our bench.
  const nameOf = (bid: string | null) => {
    if (!bid) return '';
    const all = [...(lineupsNow.current.us?.batters ?? []), ...(lineupsNow.current.them?.batters ?? []), ...bench];
    const b = all.find((x) => x.bid === bid);
    return b ? `${b.num ? `#${b.num} ` : ''}${b.name || ''}`.trim() || 'Player' : 'Player';
  };
  // Who can be credited instead on a side: its order, and ours the bench too.
  const choicesFor = (side: Side) => {
    const order = lineupsNow.current[side]?.batters ?? [];
    return side === 'us' ? [...order, ...bench.filter((p) => !order.some((x) => x.bid === p.bid))] : order;
  };
  async function editCredit(event: number, side: Side, from: string, to: string) {
    const { error } = await sb.rpc('edit_play_credit', { p_game: game.id, p_event: event, p_side: side, p_from: from, p_to: to });
    if (error) return editError(error);
    await reload(false);
    nudge();
    return null;
  }
  async function editFielding(event: number, side: Side, code: string, rows: { bid: string; f_po: number; f_a: number; f_e: number; c_pik: number }[]) {
    const { error } = await sb.rpc('edit_play_fielding', { p_game: game.id, p_event: event, p_side: side, p_code: code, p_rows: rows });
    if (error) return editError(error);
    await reload(false);
    nudge();
    return null;
  }
  // The pitching decisions: our pitchers in the order they first threw, and
  // the picks as they stand (worked out from the plays, or the scorer's own).
  const loadDecided = useCallback(async (): Promise<Decided | null> => {
    const lg = await loadLog();
    if (!lg) return null;
    const at = new Map(lg.events.map((e) => [e.id, e.seq]));
    const pitchers: string[] = [];
    for (const s of [...lg.stats].sort((x, y) => (at.get(x.event_id) ?? 0) - (at.get(y.event_id) ?? 0))) {
      if (s.side === 'us' && ((s.p_pitches ?? 0) > 0 || (s.p_bf ?? 0) > 0 || (s.p_outs ?? 0) > 0) && !pitchers.includes(s.bid)) pitchers.push(s.bid);
    }
    let picks: Picks = decided ?? { w: null, l: null, sv: null }, own = false;
    if (!log) {
      const [d, gm] = await Promise.all([
        sb.from('game_decisions').select('player_id, p_w, p_l, p_sv').eq('game_id', game.id),
        sb.from('games').select('decisions').eq('id', game.id).maybeSingle(),
      ]);
      if (d.error) return null;
      const rows = (d.data ?? []) as { player_id: string; p_w: number; p_l: number; p_sv: number }[];
      const who = (k: 'p_w' | 'p_l' | 'p_sv') => rows.find((r) => r[k] > 0)?.player_id ?? null;
      picks = { w: who('p_w'), l: who('p_l'), sv: who('p_sv') };
      // The scorer's own picks stand only for the result they were made for.
      const mine = gm.error ? null : (gm.data as { decisions?: Picks | null } | null)?.decisions;
      const result = resultFor(cur.current.g, game.is_home);
      own = !!mine && (result === 'won' ? !mine.l : result === 'lost' ? !mine.w && !mine.sv : false);
    }
    for (const id of [picks.w, picks.l, picks.sv]) if (id && !pitchers.includes(id)) pitchers.push(id);
    return { pitchers, picks, own };
  }, [sb, game.id, game.is_home, loadLog, log, decided]);
  async function saveDecided(p: Picks) {
    const { error } = await sb.rpc('set_game_decisions', { p_game: game.id, p_w: p.w, p_l: p.l, p_sv: p.sv });
    return error ? editError(error) : null;
  }
  async function clearDecided() {
    const { error } = await sb.rpc('clear_game_decisions', { p_game: game.id });
    return error ? editError(error) : null;
  }
  // Home and away the wrong way round, caught before the first pitch: swap
  // them, then load the pad again with each side batting in its own half. A
  // game is scheduled until its first play stands (an undo back to the start
  // makes it scheduled again); the seq check stops a swap over another
  // phone's first pitch.
  async function swapSides() {
    setSheet(null);
    const started = 'Home and away can be swapped only before the first pitch.';
    if (cur.current.status !== 'scheduled' || queue.current.length) { say(started); return; }
    const { data, error } = await sb.from('games').update({ is_home: !game.is_home }).eq('id', game.id).eq('status', 'scheduled').eq('seq', seq.current).select('id');
    if (error) { say(editError(error)); return; }
    if (!data?.length) { say(started); void reload(); return; }
    window.location.reload();
  }

  function endGame(final: boolean) {
    askDecide.current = final ? Date.now() : 0;
    const before = cur.current;
    history.current.push({ before, rows: [] });
    taps.current += 1;
    show({ ...before, status: final ? 'final' : 'live', last: final ? 'Game ended' : 'Game reopened' });
    queue.current.push({ kind: 'play', type: final ? 'end_game' : 'reopen_game', patch: {}, payload: { cid: cid() }, rows: [], status: final ? 'final' : 'live' });
    keep();
    setSheet(null);
    void pump();
  }

  // End game, after the scoring check. The check reads the saved log, so it
  // runs only with nothing waiting to send and an answer within 4 seconds;
  // otherwise the game ends as it always has. It never stops the end.
  const [issues, setIssues] = useState<Issue[]>([]);
  const [checking, setChecking] = useState(false);
  // Each End game tap gets a number; closing the sheet, Start over or another
  // tap moves it on, so a check that answers late does nothing.
  const endTry = useRef(0);
  const dropEnd = () => { endTry.current += 1; setChecking(false); };
  async function tryEnd() {
    if (checking) return;
    const my = ++endTry.current;
    const current = () => my === endTry.current;
    const end = () => { if (current()) { setChecking(false); endGame(true); } };
    if (queue.current.length || (typeof navigator !== 'undefined' && !navigator.onLine)) return end();
    setChecking(true);
    try {
      const load = Promise.all([
        sb.from('games').select('live').eq('id', game.id).single(),
        sb.from('game_events').select('id, seq, type, payload, prev_live').eq('game_id', game.id).order('seq'),
        sb.from('game_stats').select('event_id, side, bid, b_pa, b_h, b_r, p_bf, p_outs, p_pitches').eq('game_id', game.id),
      ]);
      const got = await Promise.race([load, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
      if (!current()) return;
      if (!got || got.some((x) => x.error)) return end();
      const gl = cur.current.g.lineups;
      const found = auditGame({
        game: { is_home: game.is_home, status: 'live', live: (got[0].data as { live: Record<string, unknown> }).live, sport: 'baseball' },
        teams: { us: team.display_name || team.name, them: game.opponent_name },
        events: (got[1].data ?? []) as SummaryEvent[], stats: (got[2].data ?? []) as SummaryStat[],
        lineups: game.is_home ? { us: gl.home, them: gl.away } : { us: gl.away, them: gl.home },
        regulationInnings: game.settings?.regulation ?? regulation, runRule: game.settings?.run_rule ?? null, ending: true,
      });
      if (!found.length) return end();
      if (!current()) return;
      setChecking(false);
      setIssues(found);
      setSheet('check');
    } catch {
      end();
    }
  }

  // What the stream shows: here at once, then saved. Any seat can run it. A
  // weak signal gets three tries before the tap is taken back.
  async function air(patch: Partial<Channel>) {
    const before = chan;
    if (!before) return;
    setChan({ ...before, ...patch });
    for (let i = 0; i < 3; i++) {
      const { error } = await sb.from('channels').update(patch).eq('team_id', team.id);
      if (!error) { nudge(); return; }
      if (error.code && !/fetch|network/i.test(error.message)) break;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
    setChan(before);
    say('That did not reach the stream. Try again.');
  }

  // A moment on the stream, once (send_cmd stamps it), and the broadcast's
  // standing settings (rally, scenes), merged key by key.
  async function send(c: Record<string, unknown> & { type: string }) {
    const { error } = await sb.rpc('send_cmd', { p_team: team.id, p_cmd: c });
    if (error) say('That did not reach the stream. Try again.'); else nudge();
  }
  async function cmd(kind: string) {
    const { error } = await sb.rpc('send_cmd', { p_team: team.id, p_cmd: { type: 'moment', kind } });
    if (error) { say('That did not reach the stream. Try again.'); return; }
    nudge();
    say(`On the stream: ${kind === 'walkoff' ? 'Walk-off' : kind}`);
  }
  async function bcast(patch: BroadcastPatch) {
    const before = chan;
    if (!before) return;
    setChan({ ...before, broadcast: mergeBroadcast(before.broadcast, patch) });
    const { data, error } = await sb.rpc('set_broadcast', { p_team: team.id, p_patch: patch });
    if (error) { setChan(before); say('That did not reach the stream. Try again.'); return; }
    setChan((c) => (c ? { ...c, broadcast: data as Broadcast } : c));
    nudge();
  }

  // Take the mid-inning board down and put the scorebug back, before the next
  // pitch would. It stays down for this break; the next third out puts it up.
  async function backToBug() {
    if (queue.current.length) await pumpRef.current();
    if (queue.current.length) { say('Plays are still sending. Try again in a moment.'); return; }
    if (chan?.card === 'mid') await air({ card: null });
    await bcast({ mid_off: { game: game.id, seq: seq.current } });
    show({ ...cur.current, rolled: false });
    say('Scorebug back on the stream');
  }

  // Start over: every play and its stats go; the game is back before the first pitch.
  async function startOver() {
    if (!window.confirm('Start this game over? Every play and its stats are cleared. Lineups stay.')) return;
    dropEnd();
    const { error } = await sb.rpc('reset_game', { p_game: game.id });
    if (error) { say(error.message || 'That did not work. Try again.'); return; }
    queue.current = [];
    keep();
    await reload();
    show({ ...cur.current, last: 'Game started over' });
    setSheet(null);
    nudge();
  }

  // A lineup edited since the last play: a pitching change moves the pitch
  // count over, and the order goes back to the kid who was up. On open, and
  // after every reload (which reads the lineups again).
  useEffect(() => { catchUp.current = () => {
    if (cur.current.status !== 'live') return;
    const p = pitcherChange(cur.current.g);
    if (p) commit(p);
    for (let i = 0; i < 2; i++) { const o = orderChange(cur.current.g); if (!o) break; commit(o); }
  }; });
  useEffect(() => {
    // Plays this phone kept but never sent (a reload, or iOS closing the tab):
    // put them back on the pad and send them, before anything can be tapped.
    // Any that had saved are found on the server by their ids and skipped
    // (pump); if another phone scored since, they are dropped and it says so.
    const kept = canScore ? readKept(game.id) : null;
    if (kept) {
      let v = cur.current;
      const stack: (typeof view)[] = [];
      for (const it of kept.items) {
        if (it.kind === 'undo') { const back = stack.pop(); if (back) v = back; continue; }
        stack.push(v);
        v = { g: { ...v.g, ...(it.patch as object) } as typeof v.g, status: it.status ?? (v.status === 'scheduled' ? 'live' : v.status), tonight: addRows(v.tonight, it.rows), last: v.last, rolled: false };
      }
      queue.current = kept.items;
      seq.current = kept.seq;
      taps.current += 1;
      const n = kept.items.length;
      show({ ...v, last: `Sending ${n} play${n > 1 ? 's' : ''} kept on this phone` });
      // Then read the game back: the stats, and an undo this phone could not redo on its own.
      void pump().then(() => reload());
    } else {
      // The page's copy of the game can be stale (the router's cache keeps the
      // pad from before a lineup edit), so read it fresh; the reload then runs
      // the catch-up.
      void reload();
    }
    // Once, when the pad opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving with plays still waiting would lose them: ask first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (queue.current.length) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const { g, status } = view;
  const final = status === 'final';
  const locked = final || !canScore;
  const batSide = L.battingSide(g) as EngineSide, fieldSide = L.fieldingSide(g) as EngineSide;
  const batLineup = g.lineups[batSide], fieldLineup = g.lineups[fieldSide];
  const bIdx = L.currentBatterIdx(g, batSide);
  const batter = batLineup?.batters?.[bIdx];
  const pitcherBidNow = fieldLineup?.positions?.P;
  const pitcher = fieldLineup?.batters?.find((b) => b.bid === pitcherBidNow) ?? null;
  const usB = brandOf(team), themB = opponentBrand(game);
  const [awayB, homeB] = game.is_home ? [themB, usB] : [usB, themB];
  const usA = team.abbr, themA = game.opponent?.abbr || game.saved?.abbr || game.opponent_abbr;
  const [awayA, homeA] = game.is_home ? [themA, usA] : [usA, themA];
  const runners = runnersOf(g);
  const b = L.safeBases(g.bases);
  const numOf = (bid: string | null, side: EngineSide) => (bid ? g.lineups[side]?.batters?.find((x) => x.bid === bid)?.num ?? '' : '');
  const seasonBy = useMemo(() => Object.fromEntries(season.map((l) => [l.player_id, l])), [season]);
  const onAir = airView(g, { tonight: view.tonight, season: seasonBy, pas: [], gameInnings: regulation });
  // Whether the mid-inning board is on the stream now: put up by hand, or by
  // itself after the play that ended the half, until it is taken down.
  const midUp = status === 'live' && !!chan && (!chan.game_id || chan.game_id === game.id)
    && (chan.card === 'mid' || (!chan.card && chan.auto_mid && view.rolled));
  const dots = (n: number, of: number, color: string) => Array.from({ length: of }, (_, i) => <i key={i} style={{ background: i < n ? color : undefined }} />);
  // The score says the game is over: offer End game, until "Not yet" for this half.
  const runRule = Number(game.settings?.run_rule) || 0;
  const overNow = status === 'live' && canScore ? gameOver(g, runRule) : null;
  const over = overNow && overNow.key !== overOff ? overNow : null;
  const overText = (o: NonNullable<typeof over>) => {
    const lead = (o.leader === 'home' ? homeB : awayB).display;
    return o.why === 'runrule' ? `${lead} by the run rule (${runRule})` : `${lead} ahead ${o.why === 'after' ? 'after a full inning' : 'in the last inning'}`;
  };

  const press = {
    ball: () => {
      const r = L.onBall(g) as Res;
      if (r.sheet !== 'walk') return commit(r);
      const w = L.computeWalk(g.bases);
      commit({ type: 'walk', patch: L.endPA(g, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(g, w.runs) }), payload: { runs: w.runs, play: L.playNote(g, 'BB', { runs: w.runs }) } });
      // Forced runners only; the rare extra base is one tap away.
      say(w.runs ? `Walk · ${w.runs} run forced in` : 'Walk', { label: 'Fix runners', run: () => setSheet('situation') });
    },
    // Swinging or looking, said on the key, as GameChanger does: strike three
    // is then one tap. A dropped third strike is on the PITCH menu.
    strike: (looking = false) => commit(L.onStrike(g, { looking })),
    foul: () => commit(L.onFoul(g)),
  };

  // Demo: the game plays itself, a pitch every 1.6 seconds, through the same
  // rules and the same queue as a tap, to try the stream without a game on.
  // The plays are real plays on this game: for a practice game.
  const [demo, setDemo] = useState(false);
  const demoStep = useRef<() => void>(() => {});
  useEffect(() => { demoStep.current = () => {
    if (cur.current.status === 'final') { setDemo(false); return; }
    const gg = cur.current.g;
    const r = Math.random();
    if (r < 0.34) press.ball();
    else if (r < 0.6) { if ((gg.strikes | 0) >= 2) commit(L.onStrike(gg, { looking: Math.random() < 0.3 })); else press.strike(); }
    else if (r < 0.75) press.foul();
    else {
      const kinds = ['H1', 'H1', 'H2', 'GB', 'GB', 'FB', 'FB', 'H3', 'HR', 'E'];
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      if (kind === 'HR') { const runs = L.computeHomeRun(gg.bases).runs; commit({ type: 'homerun', patch: L.homeRunPatch(gg, runs), payload: { runs, play: L.playNote(gg, 'HR', { runs }) } }); return; }
      const pos = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'][Math.floor(Math.random() * 9)];
      commit(onPlay(gg, { kind, pos, dest: L.playDefaults(gg, kind) as unknown as Record<string, number | 'out'> }));
    }
  }; });
  useEffect(() => {
    if (!demo) return;
    const t = window.setInterval(() => demoStep.current(), 1600);
    return () => window.clearInterval(t);
  }, [demo]);

  // Keys for a laptop at the table: the pad's own letters, ignored while a
  // sheet is open or a field has the cursor.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => { keys.current = (e) => {
    if (sheet || locked || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = ((e.target as HTMLElement | null)?.tagName ?? '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = e.key.toLowerCase();
    const direct: Record<string, string> = { 1: 'H1', 2: 'H2', 3: 'H3', e: 'E' };
    const act: Record<string, () => void> = {
      b: press.ball, s: () => press.strike(), l: () => press.strike(true), f: press.foul, i: () => setSheet('inplay'), o: () => setSheet('inplay'), m: () => setSheet('pitch'), p: () => setSheet('pitch'), u: undo,
      h: () => { const runs = L.computeHomeRun(g.bases).runs; commit({ type: 'homerun', patch: L.homeRunPatch(g, runs), payload: { runs, play: L.playNote(g, 'HR', { runs }) }, text: runs > 1 ? `Home run · ${runs} runs` : 'Home run' }); },
    };
    if (act[k]) { e.preventDefault(); act[k](); return; }
    if (direct[k]) { e.preventDefault(); setSheet('inplay'); setStartKind(direct[k]); }
  }; });
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    document.addEventListener('keydown', on);
    return () => document.removeEventListener('keydown', on);
  }, []);

  const console_ = wide && !!chan;
  const airPanel = (inline: boolean) => chan && (
    <OnAir canWrite={canWrite} channel={chan} teamId={team.id} gameId={game.id} setupHref={`/t/${slug}/stream`} view={onAir} brand={batSide === 'home' ? homeB : awayB}
      when={`${g.half === 'top' ? 'Top' : 'Bottom'} ${g.inning}`} live={status === 'live'} final={final} inline={inline}
      score={`${awayB.display} ${g.away_score | 0} · ${homeB.display} ${g.home_score | 0}`} onSet={air} onCmd={cmd} onSend={send} onBroadcast={bcast} onClose={() => setSheet(null)} />
  );

  // Who is on each base, by number and name, for the field.
  const whoOn = (bid: string | null) => {
    const x = bid ? batLineup?.batters?.find((y) => y.bid === bid) : undefined;
    return x ? { num: x.num, name: x.name } : null;
  };
  const batB = batSide === 'home' ? homeB : awayB, fieldB = batSide === 'home' ? awayB : homeB;
  const layout = useSyncExternalStore(onLayout, readLayout, () => 'field' as Layout);
  const theme = useSyncExternalStore(onTheme, readTheme, () => 'dark' as Theme);
  // A dropped third strike: with nobody on it is recorded at once; with
  // runners, the In Play sheet asks where they ended up.
  const [k3, setK3] = useState<{ how: 'WP' | 'PB' | 'out'; seq: string[] } | null>(null);
  function dropped(how: 'WP' | 'PB' | 'out', seq: string[]) {
    const anyone = b.first || b.second || b.third;
    if (anyone) { setK3({ how, seq }); setSheet('dropped'); return; }
    commit(onPlay(g, { kind: 'K3', pos: 'C', dest: { batter: how === 'out' ? 'out' : 1 }, seq: how === 'out' ? seq : null, k3: how === 'out' ? null : how }));
  }
  const recordInPlay = ({ kind, pos, dest, seq, bb, k3: why, loc }: InPlayResult) => {
    setStartKind(null); setK3(null);
    if (kind === 'HR') {
      const runs = L.computeHomeRun(g.bases).runs;
      commit({ type: 'homerun', patch: L.homeRunPatch(g, runs), payload: { runs, play: L.playNote(g, 'HR', { runs }), inputs: { bb } }, text: runs > 1 ? `Home run · ${runs} runs` : 'Home run' });
    } else commit(onPlay(g, { kind, pos: pos || null, dest, seq: seq ?? null, bb: bb ?? null, k3: why ?? null, loc: loc ?? null }));
  };

  return (
    <div className={`pad gc${theme === 'sun' ? ' sun' : ''}${console_ ? ' has-console' : ''}`}>
      <div className="pad-main">
      <header className="pad-head">
        <button type="button" className="icon-btn pad-menu" onClick={() => setSheet('menu')} aria-label="Game menu">☰</button>
        <div className="pad-score">
          {([['away', awayB, awayA], ['home', homeB, homeA]] as const).map(([side, br, ab]) => (
            <span key={side} className={`pad-team${batSide === side ? ' bat' : ''}`}>
              <TeamMark brand={br} size={28} />
              <TeamName full={br.display} short={ab} />
              <b>{side === 'away' ? g.away_score : g.home_score}</b>
            </span>
          ))}
        </div>
        <span className={`pad-sync ${online ? sync : 'retry'}`} role="status"
          aria-label={!online ? 'Offline: plays are kept and sent when the signal is back' : sync === 'ok' ? 'Saved' : sync === 'sending' ? 'Saving' : 'Waiting for signal'}>
          {waiting > 1 ? waiting : null}
        </span>
      </header>

      <button type="button" className="pad-sit" onClick={() => setSheet('situation')} disabled={!canScore}>
        <span className="pad-inning">{g.half === 'top' ? '▲' : '▼'} {g.inning}</span>
        <span className="pad-count">
          <span><em>B</em>{dots(g.balls | 0, 3, 'var(--dot-ball)')}</span>
          <span><em>S</em>{dots(g.strikes | 0, 2, 'var(--dot-strike)')}</span>
          <span><em>O</em>{dots(g.outs | 0, 2, 'var(--dot-out)')}</span>
        </span>
        <span className="pad-edit">{final ? 'FINAL ›' : 'FIX ›'}</span>
      </button>

      <div className="pad-cards">
        <button type="button" className="pad-card" onClick={() => setSheet('atbat')} aria-label="At the plate: pick the batter, sub, or fix a number or name">
          <em>AB</em>
          <span className="pad-card-main">
            <b>{batter?.num ? `#${batter.num} ` : ''}{batter?.name || (batter ? `No. ${batter.num}` : 'No lineup: tap')}</b>
            <small>{batter ? `${positionOf(batLineup, bIdx) ? `${positionOf(batLineup, bIdx)} · ` : ''}${onAir.batter?.avg ? `${onAir.batter.avg} · ` : ''}${tonight(view.tonight[batter.bid]) || 'First time up'}` : ''}</small>
          </span>
        </button>
        <button type="button" className="pad-card" onClick={() => setSheet('pitching')}
          aria-label={`${pitcher ? `Pitching: number ${pitcher.num} ${pitcher.name}` : 'No pitcher set'}, ${L.pitchCount(g)} pitches. Tap for a pitching change`}>
          <em>P</em>
          <span className="pad-card-main">
            <b>{pitcher ? `#${pitcher.num} ${shortName(pitcher.name)}` : 'Pitcher'}</b>
            <small>#P {L.pitchCount(g)} · tap to change</small>
          </span>
        </button>
      </div>

      {layout === 'field' && <FieldView fieldLineup={fieldLineup} runners={{ first: whoOn(runners.first), second: whoOn(runners.second), third: whoOn(runners.third) }}
        bases={b} batter={batter ? { num: batter.num, name: batter.name } : null} batColor={batB.color} fieldColor={fieldB.color} locked={locked}
        onPitch={() => setSheet('pitch')} onBatter={() => setSheet('atbat')} onPitcher={() => setSheet('pitching')}
        onRunner={(from) => setSheet({ runner: from })} onDrop={(from, drop) => setSheet({ runner: from, drop })} />}

      {over && (
        <div className="pad-over" role="status">
          <button type="button" className="pad-over-end" onClick={() => setSheet('end')}>
            <span>Game over? {overText(over)}</span><b>End game ›</b>
          </button>
          <button type="button" className="pad-over-no" onClick={() => setOverOff(over.key)} aria-label="Not over yet: keep playing">Not yet</button>
        </div>
      )}

      {midUp && (
        <button type="button" className="pad-mid" onClick={() => void backToBug()}>
          <span>Mid-inning board is on the stream</span><b>Back to scorebug ›</b>
        </button>
      )}

      <div className="pad-last" role="status">
        {toast?.text || view.last || (status === 'scheduled' ? 'First pitch starts the game.' : '')}
        {toast?.act && <button type="button" className="link pad-act" onClick={() => { toast.act!.run(); setToast(null); }}>{toast.act.label}</button>}
      </div>

      <div className={`pad-keys gc-keys${layout === 'keys' ? ' big' : ''}`}>
        <button type="button" className="pkey ball" onClick={press.ball} disabled={locked}>BALL</button>
        <button type="button" className="pkey strike" onClick={() => press.strike()} disabled={locked} aria-label="Strike, swing and miss">STRIKE<small>swing &amp; miss</small></button>
        <button type="button" className="pkey strike called" onClick={() => press.strike(true)} disabled={locked} aria-label="Called strike">STRIKE<small>called</small></button>
        <button type="button" className="pkey foul" onClick={press.foul} disabled={locked}>FOUL</button>
        <button type="button" className="pkey inplay" onClick={() => setSheet('inplay')} disabled={locked}>IN PLAY</button>
        {layout === 'keys' && <>
          <button type="button" className="pkey more" onClick={() => setSheet('pitch')} disabled={locked}>PITCH ▾</button>
          <div className="pkey diamond" aria-label="Runners">
            {(['second', 'third', 'first'] as const).map((k) => (
              <button key={k} type="button" className={`pbase ${k}${b[k] ? ' on' : ''}`} disabled={!b[k] || locked}
                onClick={() => setSheet({ runner: k })} aria-label={b[k] ? `Runner on ${k}${runners[k] ? `, number ${numOf(runners[k], batSide)}` : ''}` : `${k} empty`}>
                <i />{b[k] && <small>{numOf(runners[k], batSide)}</small>}
              </button>
            ))}
          </div>
        </>}
      </div>

      <nav className="pad-bar">
        <button type="button" className="pbar undo" onClick={undo} disabled={!canScore || (status === 'scheduled' && !view.last)}>Undo</button>
        <Link className="pbar" href={`/t/${slug}/games/${game.id}/lineup?side=${sideOf(game, batSide)}&from=pad`}>Lineups</Link>
        <button type="button" className="pbar" onClick={() => setSheet('plays')}>Plays</button>
        <button type="button" className={`pbar end${final ? ' on' : ''}`} onClick={() => setSheet('end')} disabled={!canScore}>{final ? 'Final' : 'End game'}</button>
        {chan && !console_ && <button type="button" className={`pbar air${chan.card ? ' on' : ''}`} onClick={() => setSheet('air')}>On Air</button>}
      </nav>
      </div>
      {console_ && <aside className="pad-console">{airPanel(true)}</aside>}

      {(sheet === 'inplay' || sheet === 'dropped') && <InPlay g={g} fieldLineup={fieldLineup}
        start={sheet === 'dropped' && k3 ? { kind: 'K3', pos: 'C', batter: k3.how === 'out' ? 'out' : 1, k3: k3.how === 'out' ? null : k3.how, seq: k3.how === 'out' ? k3.seq : [] }
          : startKind ? { kind: startKind, pos: '' } : undefined}
        onClose={() => { setSheet(null); setStartKind(null); setK3(null); }} onRecord={recordInPlay}
        onInterference={() => commit(L.onBatterInterference(g, null))} />}
      {sheet === 'pitch' && <PitchMenu g={g} fieldLineup={fieldLineup} onClose={() => setSheet(null)} onInPlay={() => setSheet('inplay')} onFoulTip={() => press.strike()} onPick={(k) => {
        commit(k === 'hbp' ? L.onHitByPitch(g) : k === 'ci' ? L.onCatcherInterference(g) : k === 'ibb' ? L.onIntentionalWalk(g) : L.onBalk(g));
      }} onInterference={(from) => commit(L.onBatterInterference(g, from))} onBatterOut={(seq) => commit(L.onBatterOut(g, { seq }))} onDropped={dropped} />}
      {sheet === 'menu' && <GameMenu final={final} lineupHref={`/t/${slug}/games/${game.id}/lineup?side=${sideOf(game, batSide)}&from=pad`} gameHref={`/t/${slug}/games/${game.id}`}
        layout={layout} onLayout={(l) => { setLayout(l); setSheet(null); }} sun={theme === 'sun'} onSun={(on) => setTheme(on ? 'sun' : 'dark')}
        onDecide={final && canScore ? () => setSheet('decide') : undefined}
        home={game.is_home} onSwap={canScore && status === 'scheduled' ? () => void swapSides() : undefined}
        onFix={() => setSheet('situation')} onPlays={() => setSheet('plays')} onEndHalf={() => commit(L.onEndHalf(g))} onEnd={() => setSheet('end')} onClose={() => setSheet(null)} />}
      {sheet && typeof sheet === 'object' && <Runner key={`${sheet.runner}${sheet.drop?.to ?? ''}${sheet.drop?.safe ?? ''}`} g={g} from={sheet.runner} drop={sheet.drop}
        who={numOf(runners[sheet.runner], batSide) ? `#${numOf(runners[sheet.runner], batSide)}` : ''}
        fieldLineup={fieldLineup} onClose={() => setSheet(null)} onInterference={() => commit(L.onBatterInterference(g, sheet.runner))}
        subs={{
          bench: sides(batSide) === 'us' ? bench.filter((p) => !(batLineup?.batters ?? []).some((x) => x.bid === p.bid)) : null,
          order: (batLineup?.batters ?? []).filter((x) => x.bid !== runners[sheet.runner] && x.bid !== batter?.bid),
        }}
        onSub={(kind, kid) => void runnerSub(sheet.runner, kind, kid)}
        onPick={(k, opts) => commit(L.onRunnerPlay(g, sheet.runner, k, opts))} />}
      {sheet === 'air' && !console_ && airPanel(false)}
      {sheet === 'situation' && <Situation g={g} final={final} labels={{ away: awayB.display, home: homeB.display }}
        extra={game.settings?.time_limit ? <GameClock gameId={game.id} initial={clock} fullSeconds={game.settings.time_limit} canRun={canScore} label="Time limit" onChange={(c) => { setClock(c); nudge(); }} /> : null}
        practice={<>
          <label className="switch">
            <span className="switch-text"><b>Demo: the game plays itself</b><small>A pitch every 1.6 s, to try the stream. Every play is real: use a practice game.</small></span>
            <input type="checkbox" checked={demo} disabled={!canScore || final} onChange={(e) => setDemo(e.target.checked)} />
          </label>
        </>}
        ending={checking} onClose={() => { dropEnd(); setSheet(null); }} onFix={(r) => { if (r) { commit(r); setSheet('situation'); } }} onEnd={(f) => (f ? void tryEnd() : endGame(false))} onStartOver={startOver} />}
      {sheet === 'atbat' && <AtBat g={g} side={batSide} labels={{ away: awayB.display, home: homeB.display }} locked={locked}
        rosterOf={(e, bid) => (sides(e) === 'us' ? rosterBy.current.get(bid) ?? null : null)}
        benchOf={(e) => (sides(e) === 'us' ? bench.filter((p) => !(g.lineups[e]?.batters ?? []).some((b) => b.bid === p.bid)) : null)}
        canRosterOf={(e) => sides(e) === 'us' && canRoster}
        lineupHref={(e) => `/t/${slug}/games/${game.id}/lineup?side=${sides(e)}&from=pad`}
        onPick={(i) => { pickBatter(i); }} onSave={saveBatter} onSub={async (e, i, kid) => { const err = await subIn(e, i, kid); if (!err) setSheet(null); return err; }}
        onClose={() => setSheet(null)} />}
      {sheet === 'plays' && <PlaysSheet load={loadLog} battingSide={(half) => sides(half === 'top' ? 'away' : 'home')}
        labels={{ us: brandOf(team).display, them: themB.display }} nameOf={nameOf} choices={choicesFor}
        positionsNow={(side) => lineupsNow.current[side]?.positions ?? {}}
        onCredit={editCredit} onRefield={editFielding} onClose={() => setSheet(null)} />}
      {sheet === 'pitching' && <Pitching g={g} side={fieldSide} labels={{ away: awayB.display, home: homeB.display }} locked={locked}
        counts={<PitchCounts load={loadLog} labels={{ us: brandOf(team).display, them: themB.display }} nameOf={nameOf} />}
        lineupHref={(e) => `/t/${slug}/games/${game.id}/lineup?side=${sides(e)}&from=pad`}
        onPick={async (e, pick) => { const err = await changePitcher(e, pick); if (!err) setSheet(null); return err; }}
        onClose={() => setSheet(null)} />}
      {sheet === 'end' && <EndGame final={final} ending={checking}
        score={`${awayB.display} ${g.away_score | 0} · ${homeB.display} ${g.home_score | 0}`}
        when={`${g.half === 'top' ? 'Top' : 'Bottom'} ${g.inning} · ${g.outs | 0} out${(g.outs | 0) === 1 ? '' : 's'}`}
        onEnd={() => void tryEnd()} onReopen={() => endGame(false)} onClose={() => { dropEnd(); setSheet(null); }} />}
      {sheet === 'check' && <EndCheck issues={issues} onClose={() => setSheet(null)} onFix={() => setSheet('situation')} onEnd={() => endGame(true)} />}
      {sheet === 'decide' && <Decisions load={loadDecided} result={resultFor(g, game.is_home)} nameOf={nameOf}
        onSave={saveDecided} onClear={clearDecided} onClose={() => setSheet(null)} />}
    </div>
  );
}
