'use client';

import { useEffect, useRef, useState } from 'react';
import type { Feed } from '@/lib/onair';

// Scoreboard's on-air spots for our own apps (public/ads, on ads/kit.js). Each
// page sits in its own transparent frame and plays when told to. A spot plays
// only when someone taps one in On Air: the tap stamps the channel, and a new
// stamp here is one play. A reload or a late-joining page never replays it.
//
// Two-Way Lab is built but off, as it was in Scoreboard.
const APPS = [
  { id: 'rtp', name: 'Run the Play', page: '/ads/runtheplay.html' },
  { id: 'ybt', name: 'Baseball Time', page: '/ads/baseballtime.html' },
];
const PRELOAD_MS = 4000;   // after the scorebug, so the bug paints first
const STALE_MS = 6000;     // a spot that could not start within this is dropped, not played late
const LONGEST_MS = 15000;  // a frame hides itself after this even if "done" never arrives

// Which app goes next: each in turn, remembered across a reload.
function nextApp() {
  let i = 0;
  try {
    i = (Number(window.localStorage.getItem('pb-spot-app')) + 1) % APPS.length || 0;
    window.localStorage.setItem('pb-spot-app', String(i));
  } catch { i = Math.floor(Math.random() * APPS.length); }
  return APPS[i];
}

export function Spots({ spot }: { spot: Feed['spot'] }) {
  const [armed, setArmed] = useState(false);
  const frames = useRef(new Map<string, HTMLIFrameElement>());
  const state = useRef(new Map<string, { ready: boolean; pending: { msg: object; at: number } | null; timer: number }>());
  const seen = useRef<number | null | undefined>(undefined);
  const n = spot?.n ?? null, cut = spot?.cut === 'inning' ? 'inning' : 'pitch';

  const of = (id: string) => {
    if (!state.current.has(id)) state.current.set(id, { ready: false, pending: null, timer: 0 });
    return state.current.get(id)!;
  };

  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), PRELOAD_MS);
    const hide = (id: string) => { window.clearTimeout(of(id).timer); frames.current.get(id)?.classList.remove('on'); };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const id = [...frames.current].find(([, el]) => el.contentWindow === e.source)?.[0];
      if (!id) return;
      const s = of(id), type = (e.data as { type?: string } | null)?.type;
      if (type === 'spot:ready') {
        s.ready = true;
        if (s.pending && Date.now() - s.pending.at < STALE_MS) frames.current.get(id)?.contentWindow?.postMessage(s.pending.msg, window.location.origin);
        else if (s.pending) hide(id);
        s.pending = null;
      }
      if (type === 'spot:done') hide(id);
    };
    window.addEventListener('message', onMessage);
    return () => { window.clearTimeout(t); window.removeEventListener('message', onMessage); };
  }, []);

  useEffect(() => {
    // The stamp the page loaded with is not a tap; only a later one is.
    if (seen.current === undefined) { seen.current = n; return; }
    if (n === null || n === seen.current) return;
    seen.current = n;
    const app = nextApp();
    // Top center: the stat cards own the top right.
    const msg = { type: 'spot:play', cut, topic: null, pos: 'tc', lift: 0 };
    const s = of(app.id);
    const play = () => {
      const el = frames.current.get(app.id);
      for (const [id, other] of frames.current) if (id !== app.id) { other.contentWindow?.postMessage({ type: 'spot:stop' }, window.location.origin); other.classList.remove('on'); }
      if (!el) { s.pending = { msg, at: Date.now() }; return; }
      el.classList.add('on');
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(() => el.classList.remove('on'), LONGEST_MS);
      if (s.ready) el.contentWindow?.postMessage(msg, window.location.origin); else s.pending = { msg, at: Date.now() };
    };
    if (!frames.current.has(app.id)) {
      // Tapped before the frames loaded: load them now; the spot starts when its page says it is ready.
      s.pending = { msg, at: Date.now() };
      window.setTimeout(() => setArmed(true), 0);
      return;
    }
    play();
  }, [n, cut]);

  if (!armed) return null;
  return (
    <>
      {APPS.map((a) => (
        <iframe key={a.id} className="ov-spot" src={`${a.page}?embed=1`} title={`${a.name} spot`} aria-hidden="true" tabIndex={-1}
          ref={(el) => {
            if (!el) { frames.current.delete(a.id); return; }
            frames.current.set(a.id, el);
            // A spot waiting on this frame shows it; the page plays it once ready.
            if (of(a.id).pending) el.classList.add('on');
          }} />
      ))}
    </>
  );
}

// For /dev/kit: taps one spot a few seconds after the page loads.
export function SpotsDemo({ cut }: { cut: 'pitch' | 'inning' }) {
  const [spot, setSpot] = useState<Feed['spot']>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setSpot({ n: Date.now(), cut }), 6000);
    return () => window.clearTimeout(t);
  }, [cut]);
  return <Spots spot={spot} />;
}
