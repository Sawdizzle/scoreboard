'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OnAir, type Channel } from '@/components/pad/OnAir';
import { airTopic } from '@/components/overlay/Overlay';
import { GameClock } from '@/components/pad/GameClock';
import { EndCheck, InPlay, More, Runner, Situation, StrikeThree } from '@/components/pad/PadSheets';
import { auditGame, type Issue } from '@/lib/audit';
import type { SummaryEvent, SummaryStat } from '@/lib/summarize';
import { brandOf, opponentBrand, TeamMark } from '@/components/TeamBrand';
import * as L from '@/lib/rules/logic.js';
import { positionOf } from '@/lib/rules/roster.js';
import { engineGame, lastPlayText, onPlay, orderChange, pitcherChange, record, runnersOf, sideOf, tonight, type EngineSide, type Res, type StatKey, type StatRow } from '@/lib/scoring';
import { mergeBroadcast, type Broadcast, type BroadcastPatch } from '@/lib/broadcast';
import { airView } from '@/lib/onair';
import { shortName } from '@/lib/format';
import type { SeasonLine } from '@/lib/stats';
import { browserClient } from '@/lib/supabase/browser';
import { CONSOLE, useMedia } from '@/lib/use-media';
import type { Game, Lineup, Side, Team } from '@/lib/types';

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

// Our batters keep the names the server put in the team's format; a lineup
// read straight from the table has the names it was saved with.
function sameNames(fresh: Lineup | undefined, named: Lineup | undefined) {
  if (!fresh || !named) return fresh;
  const by = new Map((named.batters ?? []).map((b) => [b.bid, b]));
  return { ...fresh, batters: (fresh.batters ?? []).map((b) => { const n = by.get(b.bid); return n ? { ...b, num: n.num, name: n.name } : b; }) };
}
type Sheet = null | 'k3' | 'inplay' | 'dropped' | 'more' | 'situation' | 'air' | 'check' | { runner: 'first' | 'second' | 'third' };

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
// on the diamond for steals; the bar above for corrections and End game.
//
// Every tap is applied here at once (the rules run in the browser) and queued
// for the database in order. A dropped connection only delays the queue; a
// play from another phone in between makes this pad reload rather than write
// over it.
export function Pad({ slug, team, game, lineups, season, tonightRows, regulation, canScore, canWrite = false, channel }: {
  slug: string; team: Team; game: Game & { seq: number }; lineups: Partial<Record<Side, Lineup>>;
  season: SeasonLine[]; tonightRows: StatRow[]; regulation: number; canScore: boolean; canWrite?: boolean; channel: Channel | null;
}) {
  const sb = browserClient();
  const sides = useCallback((e: EngineSide) => sideOf(game, e), [game]);
  // The lineups as last read. The page's own copy can be stale (a phone's Back
  // button shows the pad from the router's cache, from before a lineup edit),
  // so every reload reads them again.
  const lineupsNow = useRef(lineups);
  const [view, setView] = useState(() => ({
    g: engineGame(game, lineups, regulation), status: game.status as Status,
    tonight: sumRows(tonightRows), last: '',
  }));
  const cur = useRef(view);
  const history = useRef<{ before: typeof view; rows: StatRow[] }[]>([]);
  const queue = useRef<Item[]>([]);
  const sending = useRef(false);
  const seq = useRef(game.seq);
  const [sync, setSync] = useState<'ok' | 'sending' | 'retry'>('ok');
  const [sheet, setSheet] = useState<Sheet>(null);
  // A tablet or bigger keeps On Air open as a console beside the keys.
  const wide = useMedia(CONSOLE);
  const [toast, setToast] = useState<{ text: string; act?: { label: string; run: () => void } } | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [online, setOnline] = useState(true);
  const [chan, setChan] = useState(channel);
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
  const catchUp = useRef<() => void>(() => {});
  const reload = useCallback(async (after = true): Promise<boolean> => {
    const mark = taps.current;
    const [{ data: row }, { data: stats }, { data: lus, error: lusError }] = await Promise.all([
      sb.from('games').select('live, status, seq').eq('id', game.id).single(),
      sb.from('game_stats').select('*').eq('game_id', game.id),
      sb.from('game_lineups').select('side, data').eq('game_id', game.id),
    ]);
    if (!row || mark !== taps.current) return false;
    if (!lusError && lus) {
      const got: Partial<Record<Side, Lineup>> = {};
      for (const r of lus as { side: Side; data: Lineup }[]) got[r.side] = r.data;
      got.us = sameNames(got.us, lineups.us);
      lineupsNow.current = got;
    }
    seq.current = row.seq;
    history.current = [];
    show({ g: engineGame({ ...game, live: row.live, status: row.status }, lineupsNow.current, regulation), status: row.status, tonight: sumRows((stats ?? []) as StatRow[]), last: cur.current.last });
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
  const pump = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    let wait = 800;
    while (queue.current.length) {
      setSync('sending');
      setWaiting(queue.current.length);
      const it = queue.current[0];
      const { data, error } = it.kind === 'play'
        ? await sb.rpc('apply_play', { p_game: game.id, p_seq: seq.current, p_type: it.type, p_patch: it.patch, p_payload: it.payload, p_stats: it.rows, p_status: it.status })
        : await sb.rpc('undo_play', { p_game: game.id, p_seq: seq.current });
      if (error) {
        const offline = !error.code || /fetch|network|load failed/i.test(error.message);
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
            queue.current.splice(0, n);
            keep();
            wait = 800;
            nudge();
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
      queue.current.shift();
      keep();
      wait = 800;
      nudge();
    }
    sending.current = false;
    setSync('ok');
    setWaiting(0);
    // A tap made while a conflict reloaded the game: send it too.
    if (queue.current.length) window.setTimeout(() => void pumpRef.current(), 0);
  }, [sb, game.id, reload, nudge, keep]);
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
    show({ g: r.next, status: nextStatus, tonight: addRows(before.tonight, r.rows), last: lastPlayText(r.res, before.g, r.next) });
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
    taps.current += 1;
    if (h) show({ ...h.before, last: `Undone: ${cur.current.last || 'last play'}` });
    queue.current.push({ kind: 'undo' });
    keep();
    void pump().then(() => { if (!h) void reload(); });
  }

  function endGame(final: boolean) {
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
        v = { g: { ...v.g, ...(it.patch as object) } as typeof v.g, status: it.status ?? (v.status === 'scheduled' ? 'live' : v.status), tonight: addRows(v.tonight, it.rows), last: v.last };
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
  const runners = runnersOf(g);
  const b = L.safeBases(g.bases);
  const numOf = (bid: string | null, side: EngineSide) => (bid ? g.lineups[side]?.batters?.find((x) => x.bid === bid)?.num ?? '' : '');
  const seasonBy = useMemo(() => Object.fromEntries(season.map((l) => [l.player_id, l])), [season]);
  const onAir = airView(g, { tonight: view.tonight, season: seasonBy, pas: [], gameInnings: regulation });
  const dots = (n: number, of: number, color: string) => Array.from({ length: of }, (_, i) => <i key={i} style={{ background: i < n ? color : undefined }} />);

  const press = {
    ball: () => {
      const r = L.onBall(g) as Res;
      if (r.sheet !== 'walk') return commit(r);
      const w = L.computeWalk(g.bases);
      commit({ type: 'walk', patch: L.endPA(g, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(g, w.runs) }), payload: { runs: w.runs, play: L.playNote(g, 'BB', { runs: w.runs }) } });
      // Forced runners only; the rare extra base is one tap away.
      say(w.runs ? `Walk · ${w.runs} run forced in` : 'Walk', { label: 'Fix runners', run: () => setSheet('situation') });
    },
    strike: () => ((g.strikes | 0) >= 2 ? setSheet('k3') : commit(L.onStrike(g))),
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
      b: press.ball, s: press.strike, f: press.foul, i: () => setSheet('inplay'), o: () => setSheet('inplay'), m: () => setSheet('more'), u: undo,
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

  return (
    <div className={`pad${console_ ? ' has-console' : ''}`}>
      <div className="pad-main">
      <header className="pad-head">
        <Link href={`/t/${slug}/games/${game.id}`} aria-label="Leave the pad" className="icon-btn">‹</Link>
        <div className="pad-score">
          {[['away', awayB], ['home', homeB]].map(([side, br]) => (
            <span key={side as string} className={`pad-team${batSide === side ? ' bat' : ''}`}>
              <TeamMark brand={br as typeof usB} size={28} />
              <span className="pad-name">{(br as typeof usB).display}</span>
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
          <span><em>B</em>{dots(g.balls | 0, 3, '#35d07f')}</span>
          <span><em>S</em>{dots(g.strikes | 0, 2, '#e5534b')}</span>
          <span><em>O</em>{dots(g.outs | 0, 2, '#e0a92a')}</span>
        </span>
        <span className="pad-edit">{final ? 'FINAL ›' : 'FIX ›'}</span>
      </button>

      <Link href={`/t/${slug}/games/${game.id}/lineup?side=${sideOf(game, batSide)}`} className="pad-batter">
        <span className="pad-num">{batter?.num ? `#${batter.num}` : '—'}</span>
        <span className="row-main">
          <span className="row-title">{batter?.name || (batter ? `No. ${batter.num}` : 'No lineup: tap to set it')}
            {batter && <small>{positionOf(batLineup, bIdx) || ''}</small>}</span>
          <span className="pad-line">
            {onAir.batter?.avg && <b>{onAir.batter.avg}</b>}
            {batter && <span>{tonight(view.tonight[batter.bid]) || 'First time up'}</span>}
          </span>
        </span>
        <span className="pad-pitcher">
          <small>{pitcher ? `#${pitcher.num} ${shortName(pitcher.name)}` : 'Pitcher'}</small>
          <b>{L.pitchCount(g)}</b>
        </span>
      </Link>

      <div className="pad-last" role="status">
        {toast?.text || view.last || (status === 'scheduled' ? 'First pitch starts the game.' : '')}
        {toast?.act && <button type="button" className="link pad-act" onClick={() => { toast.act!.run(); setToast(null); }}>{toast.act.label}</button>}
      </div>

      <div className="pad-keys">
        <button type="button" className="pkey ball" onClick={press.ball} disabled={locked}>BALL</button>
        <button type="button" className="pkey strike" onClick={press.strike} disabled={locked}>STRIKE</button>
        <button type="button" className="pkey foul" onClick={press.foul} disabled={locked}>FOUL</button>
        <button type="button" className="pkey inplay" onClick={() => setSheet('inplay')} disabled={locked}>IN PLAY</button>
        <button type="button" className="pkey more" onClick={() => setSheet('more')} disabled={locked}>MORE ▾</button>
        <div className="pkey diamond" aria-label="Runners">
          {(['second', 'third', 'first'] as const).map((k) => (
            <button key={k} type="button" className={`pbase ${k}${b[k] ? ' on' : ''}`} disabled={!b[k] || locked}
              onClick={() => setSheet({ runner: k })} aria-label={b[k] ? `Runner on ${k}${runners[k] ? `, number ${numOf(runners[k], batSide)}` : ''}` : `${k} empty`}>
              <i />{b[k] && <small>{numOf(runners[k], batSide)}</small>}
            </button>
          ))}
        </div>
      </div>

      <nav className="pad-bar">
        <button type="button" className="pbar undo" onClick={undo} disabled={!canScore || (status === 'scheduled' && !view.last)}>Undo</button>
        <Link className="pbar" href={`/t/${slug}/games/${game.id}/lineup?side=${sideOf(game, fieldSide)}`}>Field</Link>
        <Link className="pbar" href={`/t/${slug}/games/${game.id}`}>Game</Link>
        {chan && !console_ && <button type="button" className={`pbar air${chan.card ? ' on' : ''}`} onClick={() => setSheet('air')}>On Air</button>}
      </nav>
      </div>
      {console_ && <aside className="pad-console">{airPanel(true)}</aside>}

      {sheet === 'k3' && <StrikeThree g={g} onClose={() => setSheet(null)} onPick={(k) => {
        // A dropped third strike is a ball in play for the runners: the batter may run.
        if (k === 'dropped') setSheet('dropped'); else commit(L.onStrike(g, { looking: k === 'look' }));
      }} />}
      {(sheet === 'inplay' || sheet === 'dropped') && <InPlay g={g} start={sheet === 'dropped' ? { kind: 'K3', pos: 'C' } : startKind ? { kind: startKind, pos: '' } : undefined}
        onClose={() => { setSheet(null); setStartKind(null); }} onRecord={({ kind, pos, dest }) => {
        setStartKind(null);
        if (kind === 'HR') { const runs = L.computeHomeRun(g.bases).runs; commit({ type: 'homerun', patch: L.homeRunPatch(g, runs), payload: { runs, play: L.playNote(g, 'HR', { runs }) }, text: runs > 1 ? `Home run · ${runs} runs` : 'Home run' }); }
        else commit(onPlay(g, { kind, pos: pos || null, dest }));
      }} />}
      {sheet === 'more' && <More g={g} onClose={() => setSheet(null)} onPick={(k) => {
        commit(k === 'hbp' ? L.onHitByPitch(g) : k === 'ci' ? L.onCatcherInterference(g) : k === 'ibb' ? L.onIntentionalWalk(g) : L.onBalk(g));
      }} />}
      {sheet && typeof sheet === 'object' && <Runner g={g} from={sheet.runner} who={numOf(runners[sheet.runner], batSide) ? `#${numOf(runners[sheet.runner], batSide)}` : ''}
        onClose={() => setSheet(null)} onPick={(k) => commit(k === 'BI' ? L.onBatterInterference(g, sheet.runner) : L.onRunnerPlay(g, sheet.runner, k))} />}
      {sheet === 'air' && !console_ && airPanel(false)}
      {sheet === 'situation' && <Situation g={g} final={final} labels={{ away: awayB.display, home: homeB.display }}
        extra={<>
          {game.settings?.time_limit ? <GameClock gameId={game.id} initial={game.clock} fullSeconds={game.settings.time_limit} canRun={canScore} label="Time limit" onChange={nudge} /> : null}
          <label className="switch">
            <span className="switch-text"><b>Demo: the game plays itself</b><small>A pitch every 1.6 s, to try the stream. Every play is real: use a practice game.</small></span>
            <input type="checkbox" checked={demo} disabled={!canScore || final} onChange={(e) => setDemo(e.target.checked)} />
          </label>
        </>}
        ending={checking} onClose={() => { dropEnd(); setSheet(null); }} onFix={(r) => { if (r) { commit(r); setSheet('situation'); } }} onEnd={(f) => (f ? void tryEnd() : endGame(false))} onStartOver={startOver} />}
      {sheet === 'check' && <EndCheck issues={issues} onClose={() => setSheet(null)} onFix={() => setSheet('situation')} onEnd={() => endGame(true)} />}
    </div>
  );
}
