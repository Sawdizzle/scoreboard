'use client';

import { useEffect, useRef } from 'react';
import type { Feed } from '@/lib/onair';
import { browserClient } from '@/lib/supabase/browser';
import { joinClip, mainKind, wantClip, MAX_DELAY_MS, type Pending } from '@/lib/clips';

// OBS, driven from the pad (v4's js/obs-pad.js and the overlay's relay). The
// pad has no window.obsstudio: OBS injects it only into its own Browser
// Sources. So the pad stamps a command on the channel (send_cmd), this page,
// running inside OBS, carries it out, and reports what OBS says back
// (obs_report → channel_obs) for the pad's OBS panel to read.
//
// What OBS lets a page do is the Browser Source's "Page permissions": Basic (3)
// saves the replay buffer, Advanced (4) switches scenes and starts the buffer,
// Full (5) goes live and records. Outside OBS, or in a preview tab, this stays
// silent, so it can never speak for the real source.
type ObsStudio = Record<string, ((...a: unknown[]) => unknown) | undefined>;
const obs = () => (window as Window & { obsstudio?: ObsStudio }).obsstudio;
const ACTIONS: Record<string, [string, number]> = {
  stream_start: ['startStreaming', 5], stream_stop: ['stopStreaming', 5], record_start: ['startRecording', 5], record_stop: ['stopRecording', 5],
  buffer_start: ['startReplayBuffer', 4], buffer_stop: ['stopReplayBuffer', 4],
};
const EVENTS = ['obsStreamingStarted', 'obsStreamingStopped', 'obsRecordingStarted', 'obsRecordingStopped', 'obsRecordingPaused', 'obsRecordingUnpaused',
  'obsReplaybufferStarted', 'obsReplaybufferStopped', 'obsSceneChanged', 'obsSceneListChanged'];

function ask<T>(fn: string, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const f = obs()?.[fn];
    if (typeof f !== 'function') return resolve(fallback);
    let done = false;
    const finish = (v: T) => { if (!done) { done = true; resolve(v); } };
    try { f((v: T) => finish(v)); } catch { finish(fallback); }
    window.setTimeout(() => finish(fallback), 700);
  });
}
const sceneName = (v: unknown) => (typeof v === 'string' ? v : (v as { name?: string } | null)?.name) || '';

export function ObsBridge({ token, feed, fx }: { token: string; feed: Feed | null; fx: { kind: string; n: number; play?: boolean } | null }) {
  const level = useRef<number | null>(null);
  const replay = useRef<{ n: number; ok: boolean; code: string } | null>(null);
  const seen = useRef<number | undefined>(undefined);
  const timers = useRef(new Map<number, number>());
  const report = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!obs()) return;
    const sb = browserClient();
    report.current = async () => {
      if (level.current === null) {
        const guess = typeof obs()?.saveReplayBuffer === 'function' ? 3 : 0;
        const l = await ask<number | null>('getControlLevel', null);
        level.current = l == null ? guess : Number(l) | 0;
      }
      const [st, list, cur] = await Promise.all([
        ask<Record<string, boolean> | null>('getStatus', null), ask<unknown[] | null>('getScenes', null), ask<unknown>('getCurrentScene', null)]);
      await sb.rpc('obs_report', { p_token: token, p_obs: {
        level: level.current, streaming: st ? !!st.streaming : null, recording: st ? !!st.recording : null,
        paused: st ? !!st.recordingPaused : null, buffer: st ? !!st.replaybuffer : null,
        scenes: Array.isArray(list) ? list.map(sceneName).filter(Boolean).slice(0, 60) : [], current: sceneName(cur), replay: replay.current,
      } });
    };
    void report.current();
    const on = () => void report.current();
    const saved = () => { if (replay.current) { replay.current = { ...replay.current, ok: true, code: 'saved' }; } void report.current(); };
    for (const e of EVENTS) window.addEventListener(e, on);
    window.addEventListener('obsReplaybufferSaved', saved);
    const t = window.setInterval(on, 60000);
    return () => { for (const e of EVENTS) window.removeEventListener(e, on); window.removeEventListener('obsReplaybufferSaved', saved); window.clearInterval(t); };
  }, [token]);

  // Every save is logged (clip_report → game_clips) with the game as it stood
  // when the moment was heard, so the game page can list and place it.
  const feedRef = useRef(feed);
  const kinds = useRef(feed?.broadcast?.obs?.clip_kinds);
  // Before the effects below, so they read this feed, not the one before.
  useEffect(() => { feedRef.current = feed; kinds.current = feed?.broadcast?.obs?.clip_kinds; }, [feed]);
  // One at a time, in order: "armed" must land before "asked" for the same clip.
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const clip = useRef((c: Record<string, unknown>) => {
    if (!obs()) return;
    chain.current = chain.current.then(() => browserClient().rpc('clip_report', { p_token: token, p_clip: c })).catch(() => {});
  });
  const where = () => {
    const f = feedRef.current, g = f?.game;
    const live = (g?.live ?? {}) as { inning?: number; half?: string; home_score?: number; away_score?: number };
    return { game_id: g?.id ?? null, seq: f?.last?.seq ?? null, inning: Number(live.inning) || null, half: live.half === 'bottom' ? 'bottom' : live.half === 'top' ? 'top' : null,
      home: Number(live.home_score) || 0, away: Number(live.away_score) || 0 };
  };
  // Saves OBS was asked for, oldest first; each "saved" event answers the oldest.
  const waiting = useRef<{ n: number; timer: number }[]>([]);
  // The auto-clip still waiting to save, and the last few saved, with their
  // play: an undo cancels the first and discards the others.
  const pending = useRef<(Pending & { timer: number; game: string | null; seq: number | null }) | null>(null);
  const recent = useRef<{ n: number; game: string | null; seq: number | null }[]>([]);

  // Save the buffer now, or after a delay; the result goes back to the pad.
  const save = useRef((n: number, delay: number, manual = false) => {
    const go = () => {
      timers.current.delete(n);
      if (pending.current?.n === n) pending.current = null;
      if ((level.current ?? 0) < 3 || typeof obs()?.saveReplayBuffer !== 'function') {
        replay.current = { n, ok: false, code: 'noperm' }; void report.current(); clip.current({ n, status: 'missed', code: 'noperm' }); return;
      }
      replay.current = { n, ok: false, code: 'asked' };
      try {
        obs()!.saveReplayBuffer!();
        clip.current({ n, status: 'asked' });
        // No word from OBS in 20 s: the buffer was off, or the save failed.
        waiting.current.push({ n, timer: window.setTimeout(() => {
          waiting.current = waiting.current.filter((w) => w.n !== n);
          clip.current({ n, status: 'missed', code: 'nosave' });
        }, 20000) });
      } catch { replay.current = { n, ok: false, code: 'failed' }; clip.current({ n, status: 'missed', code: 'failed' }); }
      void report.current();
    };
    if (manual) { const w = where(); clip.current({ n, status: 'armed', kind: 'manual', source: 'manual', ...w }); }
    if (delay > 0) { replay.current = { n, ok: true, code: 'armed' }; void report.current(); timers.current.set(n, window.setTimeout(go, Math.min(delay, MAX_DELAY_MS))); }
    else go();
  });
  useEffect(() => {
    const saved = () => {
      const w = waiting.current.shift();
      if (!w) return;
      window.clearTimeout(w.timer);
      clip.current({ n: w.n, status: 'saved' });
    };
    window.addEventListener('obsReplaybufferSaved', saved);
    return () => window.removeEventListener('obsReplaybufferSaved', saved);
  }, []);

  // Commands from the pad: once per stamp, and never one already on the channel when the page loaded.
  const cmd = feed?.cmd;
  useEffect(() => {
    if (!obs() || !cmd) return;
    const n = Number(cmd.n) || 0;
    if (seen.current === undefined) { seen.current = n; return; }
    if (n <= seen.current) return;
    seen.current = n;
    if (cmd.type === 'obs') {
      const a = ACTIONS[String(cmd.action)];
      const f = a && obs()?.[a[0]];
      if (a && (level.current ?? 0) >= a[1] && typeof f === 'function') { try { f(); } catch { /* OBS said no */ } }
      void report.current();
    } else if (cmd.type === 'scene') {
      const f = obs()?.setCurrentScene;
      if ((level.current ?? 0) >= 4 && typeof f === 'function' && cmd.name) { try { f(String(cmd.name)); } catch { /* unknown scene */ } }
      void report.current();
    } else if (cmd.type === 'replay') {
      if (cmd.flush) { for (const [k, t] of timers.current) { window.clearTimeout(t); save.current(k, 0); } return; }
      save.current(n, Number(cmd.delay_ms) || 0, true);
    }
  }, [cmd]);

  // Auto-clip: a picked moment saves the buffer once it has played out.
  // Moments close together are one clip, saved after whichever ends later.
  const auto = !!feed?.broadcast?.obs?.auto_clip;
  const handled = useRef(0);
  useEffect(() => {
    if (!obs() || !auto || !fx || fx.n <= handled.current || !wantClip(fx.kind, kinds.current)) return;
    handled.current = fx.n;
    const was = pending.current;
    const { clip: c, merged } = joinClip(was, fx.kind, fx.n);
    // A moment tapped in On Air is no play: no undo takes it back.
    const w = { ...where(), ...(fx.play === false ? { seq: null } : {}) };
    if (merged && was) { window.clearTimeout(was.timer); timers.current.delete(was.n); }
    const timer = window.setTimeout(() => {
      recent.current = [...recent.current, { n: c.n, game: w.game_id, seq: merged && was ? was.seq : w.seq }].slice(-12);
      save.current(c.n, 0);
    }, Math.max(0, c.fireAt - Date.now()));
    timers.current.set(c.n, timer);
    pending.current = { ...c, timer, game: merged && was ? was.game : w.game_id, seq: merged && was ? was.seq : w.seq };
    replay.current = { n: c.n, ok: true, code: 'armed' };
    void report.current();
    clip.current({ n: c.n, status: 'armed', kind: mainKind(c.kinds), kinds: c.kinds, source: 'auto', ...(merged ? {} : w) });
  }, [fx, auto]);

  // An undo takes back the play a clip was for: before the save, it never
  // saves; after, the clip is marked discarded. The file stays on disk.
  const lastSeq = feed?.last?.seq ?? null;
  const gameId = feed?.game?.id ?? null;
  useEffect(() => {
    const gone = (c: { game: string | null; seq: number | null }) => c.seq != null && c.game === gameId && (lastSeq == null || lastSeq < c.seq);
    const p = pending.current;
    if (p && gone(p)) {
      window.clearTimeout(p.timer); timers.current.delete(p.n); pending.current = null;
      clip.current({ n: p.n, status: 'discarded', code: 'undone' });
    }
    const drop = recent.current.filter(gone);
    if (drop.length) {
      recent.current = recent.current.filter((c) => !drop.includes(c));
      for (const c of drop) clip.current({ n: c.n, status: 'discarded', code: 'undone' });
    }
  }, [lastSeq, gameId]);

  return null;
}
