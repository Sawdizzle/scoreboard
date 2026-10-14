'use client';

import { useEffect, useState } from 'react';
import { Stage } from '@/components/overlay/Stage';
import type { CardKind, Feed } from '@/lib/onair';

// The Stream screen's preview: the same drawing as the real stream, fed by
// the screen it sits in instead of the database. It has no data of its own;
// the screen posts a made-up game with the settings being edited.
export function OverlayDemo() {
  const [msg, setMsg] = useState<{ feed: Feed; card: CardKind | null } | null>(null);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const d = e.data as { type?: string; feed?: Feed; card?: CardKind | null } | null;
      if (d?.type === 'pb:demo' && d.feed) setMsg({ feed: d.feed, card: d.card ?? null });
    };
    window.addEventListener('message', onMessage);
    if (window.parent !== window) window.parent.postMessage({ type: 'pb:demo-ready' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  return <Stage feed={msg?.feed ?? null} card={msg?.card ?? null} />;
}
