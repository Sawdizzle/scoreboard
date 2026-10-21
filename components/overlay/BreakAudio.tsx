'use client';

import { useEffect, useRef } from 'react';
import * as M from '@/lib/fx/music';
import { breakOf, DEFAULT_TRACK, MUSIC_VOLUME, TRACKS, trackOf } from '@/lib/music';
import { MIC_KINDS, obsConnect, ObsWsError, type ObsWs } from '@/lib/obs-ws';
import type { Feed } from '@/lib/onair';

// Breaks in play on the stream: Starting Soon, the mid-inning board, Game
// paused and Final. While one is up, a quiet music bed plays and, when the
// Browser Source URL carries the obs-websocket password (#obs=...), OBS's mic
// inputs are muted; both come back when play does. Only the mics this page
// muted are unmuted, so one muted by hand stays muted. Outside OBS the mic is
// never touched, so a preview tab cannot mute the real stream.
// inputs: every OBS input that carries audio, for the Stream screen to pick
// from; mics: the ones muted when none is picked (MIC_KINDS).
export type MicReport = { ws: 'ok' | 'auth' | 'refused' | 'nopass'; muted: boolean; inputs: string[]; mics?: string[] };
export const MIC_EVENT = 'sb-mic';
const KEPT = 'sb-mic-muted';
let report: MicReport | null = null;
export const micReport = () => report;
const say = (r: MicReport | null) => { report = r; window.dispatchEvent(new Event(MIC_EVENT)); };

type Input = { inputName: string; unversionedInputKind?: string; inputKind?: string };
const kept = (): string[] => { try { return JSON.parse(window.localStorage.getItem(KEPT) || '[]'); } catch { return []; } };
const keep = (names: string[]) => { try { window.localStorage.setItem(KEPT, JSON.stringify(names)); } catch { /* no storage: a reload mid-break leaves the mic muted */ } };

export function BreakAudio({ feed }: { feed: Feed | null }) {
  const kind = breakOf(feed);
  const music = feed?.broadcast?.music;
  const mic = feed?.broadcast?.obs?.mic;

  // The music: the break's track, or a fade to nothing.
  const src = music?.on && kind ? trackOf(music.tracks?.[kind] ?? DEFAULT_TRACK[kind])?.src ?? null : null;
  useEffect(() => { if (music?.on) M.preload(TRACKS.map((t) => t.src)); }, [music?.on]);
  useEffect(() => { M.setVolume(music?.volume ?? MUSIC_VOLUME); }, [music?.volume]);
  useEffect(() => { if (src) void M.play(src); else M.stop(); }, [src]);
  useEffect(() => () => M.stop(), []);

  // The mic, over obs-websocket.
  const sock = useRef<ObsWs | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const want = useRef(false);
  const picked = useRef<string[] | undefined>(undefined);
  const live = !!kind && !!mic?.on;
  const pick = mic?.inputs?.join('\n') ?? '';

  // Mute or unmute to match the break, one change at a time.
  const sync = useRef(() => {
    chain.current = chain.current.then(async () => {
      const ws = sock.current;
      if (!ws) return;
      const { inputs } = await ws.call<{ inputs: Input[] }>('GetInputList');
      // Which inputs carry audio: OBS answers GetInputMute only for those.
      // Browser Sources are left out: one of them is this page, playing the music.
      const heard = await Promise.all(inputs.filter((i) => (i.unversionedInputKind || i.inputKind) !== 'browser_source').slice(0, 60).map((i) =>
        ws.call<{ inputMuted: boolean }>('GetInputMute', { inputName: i.inputName }).then((r) => ({ ...i, muted: r.inputMuted }), () => null)));
      const audio = heard.filter((i) => i !== null);
      const mics = audio.filter((i) => MIC_KINDS.has(i.unversionedInputKind || i.inputKind || '')).map((i) => i.inputName);
      const ours = kept();
      if (want.current) {
        const names = new Set(audio.map((i) => i.inputName));
        for (const name of picked.current?.filter((n) => names.has(n)) ?? mics) {
          if (ours.includes(name) || audio.find((i) => i.inputName === name)?.muted) continue;
          try { await ws.call('SetInputMute', { inputName: name, inputMuted: true }); } catch { continue; }
          ours.push(name); keep(ours);
        }
      } else {
        for (const name of [...ours]) {
          try { await ws.call('SetInputMute', { inputName: name, inputMuted: false }); } catch { /* renamed or removed in OBS */ }
          ours.splice(ours.indexOf(name), 1); keep(ours);
        }
      }
      say({ ws: 'ok', muted: ours.length > 0, inputs: audio.map((i) => i.inputName).slice(0, 40), mics });
    }).catch(() => {});
  });

  const on = !!mic?.on;
  useEffect(() => {
    const obs = (window as Window & { obsstudio?: unknown }).obsstudio;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    if (!obs || !on) return;
    const resync = sync.current;
    if (!hash.has('obs')) { say({ ws: 'nopass', muted: false, inputs: [] }); return; }
    let stop = false, retry = 0;
    const open = async () => {
      try {
        const ws = await obsConnect(hash.get('obs') ?? '');
        if (stop) { ws.close(); return; }
        sock.current = ws;
        resync();
        // A source added or renamed in OBS shows up on the Stream screen within half a minute.
        const fresh = window.setInterval(resync, 30000);
        await ws.closed;
        window.clearInterval(fresh);
        sock.current = null;
        if (!stop) { say({ ws: 'refused', muted: false, inputs: [] }); retry = window.setTimeout(open, 5000); }
      } catch (e) {
        const auth = e instanceof ObsWsError && e.code === 'auth';
        say({ ws: auth ? 'auth' : 'refused', muted: false, inputs: [] });
        if (!stop) retry = window.setTimeout(open, auth ? 60000 : 15000);
      }
    };
    void open();
    return () => {
      stop = true;
      window.clearTimeout(retry);
      // Switched off mid-break: give the mic back before letting go.
      want.current = false;
      resync();
      void chain.current.then(() => { sock.current?.close(); sock.current = null; say(null); });
    };
  }, [on]);

  // Back from a break: the mic returns as the music fades, not before.
  useEffect(() => {
    want.current = live;
    picked.current = pick ? pick.split('\n') : undefined;
    if (live) { sync.current(); return; }
    const t = window.setTimeout(() => sync.current(), 1200);
    return () => window.clearTimeout(t);
  }, [live, pick]);

  return null;
}
