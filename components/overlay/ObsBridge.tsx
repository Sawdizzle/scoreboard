'use client';

import { useEffect, useRef } from 'react';
import type { Feed } from '@/lib/onair';
import { browserClient } from '@/lib/supabase/browser';

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
// How long after a big moment to save the buffer, so the clip catches the trot and the celebration.
export const CLIP_DELAY_MS: Record<string, number> = { homerun: 40000, walkoff: 60000, touchdown: 30000, goal: 30000, doubleplay: 10000, bigplay: 12000 };
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

export function ObsBridge({ token, feed, fx }: { token: string; feed: Feed | null; fx: { kind: string; n: number } | null }) {
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

  // Save the buffer now, or after a delay; the result goes back to the pad.
  const save = useRef((n: number, delay: number) => {
    const go = () => {
      timers.current.delete(n);
      if ((level.current ?? 0) < 3 || typeof obs()?.saveReplayBuffer !== 'function') { replay.current = { n, ok: false, code: 'noperm' }; void report.current(); return; }
      replay.current = { n, ok: false, code: 'asked' };
      try { obs()!.saveReplayBuffer!(); } catch { replay.current = { n, ok: false, code: 'failed' }; }
      void report.current();
    };
    if (delay > 0) { replay.current = { n, ok: true, code: 'armed' }; void report.current(); timers.current.set(n, window.setTimeout(go, Math.min(delay, 180000))); }
    else go();
  });

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
      save.current(n, Number(cmd.delay_ms) || 0);
    }
  }, [cmd]);

  // Auto-clip: a big moment on the stream saves the buffer once it has played out.
  const auto = !!feed?.broadcast?.obs?.auto_clip;
  useEffect(() => {
    if (!obs() || !auto || !fx || !(fx.kind in CLIP_DELAY_MS)) return;
    save.current(fx.n, CLIP_DELAY_MS[fx.kind]);
  }, [fx, auto]);

  return null;
}
