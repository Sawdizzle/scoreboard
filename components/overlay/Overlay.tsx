'use client';

import { useEffect, useRef, useState } from 'react';
import { Stage } from '@/components/overlay/Stage';
import { feedView, type Feed } from '@/lib/onair';
import { browserClient } from '@/lib/supabase/browser';

const POLL_MS = 2500;
const AUTO_CARD_MS = 6000;
export const airTopic = (token: string) => `overlay:${token}`;

// The page OBS loads. It has no account: it asks for the feed by the link's
// token, again every few seconds, and at once when the pad says something
// changed. A poll that finds nothing new gets a one-line answer back, so a
// source left running all afternoon costs next to nothing.
export function Overlay({ token, initial }: { token: string; initial: Feed | null }) {
  const [feed, setFeed] = useState<Feed | null>(initial);
  const [auto, setAuto] = useState(false);
  const first = useRef(initial);

  useEffect(() => {
    const sb = browserClient();
    let stopped = false, busy = false, again = false, timer = 0;
    let have = first.current?.v ?? null;
    // undefined until the first feed: a card never pops just because the page loaded.
    let batter: string | null | undefined = first.current ? feedView(first.current)?.air.batter?.bid ?? null : undefined;

    const load = async () => {
      if (busy) { again = true; return; }
      busy = true;
      try {
        const { data } = await sb.rpc('overlay_feed', { p_token: token, p_have: have });
        const f = data as Feed | { v: string } | null;
        if (stopped || !f || !('game' in f)) return;
        have = f.v;
        const now = feedView(f)?.air.batter?.bid ?? null;
        if (batter !== undefined && now && now !== batter && f.auto_card && f.game?.status === 'live') {
          setAuto(true);
          window.clearTimeout(timer);
          timer = window.setTimeout(() => setAuto(false), AUTO_CARD_MS);
        }
        batter = now;
        setFeed(f);
      } catch { /* a dropped connection: the next poll tries again */ } finally {
        busy = false;
        if (again && !stopped) { again = false; void load(); }
      }
    };

    void load();
    const poll = window.setInterval(load, POLL_MS);
    const channel = sb.channel(airTopic(token)).on('broadcast', { event: 'tick' }, () => void load()).subscribe();
    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [token]);

  return <Stage feed={feed} card={feed?.card ?? (auto ? 'batter' : null)} />;
}
