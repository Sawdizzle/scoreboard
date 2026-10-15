'use client';

import { useEffect, useMemo, useState } from 'react';
import { Scenes, type Weather } from '@/components/overlay/Scenes';
import { Stage } from '@/components/overlay/Stage';
import type { CardKind, Feed } from '@/lib/onair';

// A fine evening, for the scenes' weather line in the preview.
const WX: Weather = { temp: 72, text: 'Clear', icon: '☀️', wind: 8, dir: 'SW', pop: 10 };

// The Stream screen's preview: the same drawing as the real stream, fed by
// the screen it sits in instead of the database. It has no data of its own;
// the screen posts a made-up game with the settings being edited. A scene
// shown here gets made-up times: first pitch twelve minutes out, a restart
// twenty-four.
export function OverlayDemo() {
  const [msg, setMsg] = useState<{ feed: Feed; card: CardKind | null } | null>(null);
  const [now, setNow] = useState(0);
  const [base, setBase] = useState(0);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; feed?: Feed; card?: CardKind | null } | null;
      if (d?.type === 'pb:demo' && d.feed) setMsg({ feed: d.feed, card: d.card ?? null });
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: 'pb:demo-ready' }, window.location.origin);
    const first = window.setTimeout(() => { const t = Date.now(); setBase(t); setNow(t); }, 0);
    const tick = window.setInterval(() => setNow(Date.now()), 500);
    return () => { window.removeEventListener('message', onMessage); window.clearTimeout(first); window.clearInterval(tick); };
  }, []);
  const feed = useMemo(() => {
    const f = msg?.feed;
    const scene = f?.broadcast?.scene;
    if (!f || !scene || !base || !f.game) return f ?? null;
    const iso = (ms: number) => new Date(base + ms).toISOString();
    return {
      ...f,
      game: { ...f.game, starts_at: f.game.starts_at ?? iso(12 * 60000) },
      broadcast: { ...f.broadcast, scene: scene.kind === 'paused' ? { ...scene, at: iso(24 * 60000), since: iso(-6 * 60000) } : scene },
    } as Feed;
  }, [msg, base]);
  return (
    <>
      <Stage feed={feed} card={msg?.card ?? null} now={now} />
      <Scenes feed={feed} now={now} weather={WX} strike={0} />
    </>
  );
}
