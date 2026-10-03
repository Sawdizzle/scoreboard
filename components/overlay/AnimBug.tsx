'use client';

import { useEffect, useRef } from 'react';

// One of Scoreboard's animated bugs, in a transparent frame over the stage.
// The page (public/bugs/<slug>.html on bugs/kit.js) draws the game and plays
// its own moments; this hands it each new state, and the stinger for the play
// that made it, once.
export function AnimBug({ slug, state, anim, seq }: { slug: string; state: object; anim: { type: string; meta: object } | null; seq: number | null }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const msg = useRef<object | null>(null);
  // The newest play already animated. Unset until the first state: a bug that
  // has just loaded paints the game as it stands.
  const seen = useRef<number | null | undefined>(undefined);
  const json = JSON.stringify(state);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const post = (m: object | null) => { if (m) el.contentWindow?.postMessage(m, window.location.origin); };
    const fresh = seen.current !== undefined && seq !== null && seq > (seen.current ?? -1);
    if (seq !== null || seen.current === undefined) seen.current = seq;
    // The bugs are drawn small on a 1920 stage; 1.4 sits level with Pressbox's own.
    const view = { pos: 'bl', scale: 1.4, lift: 0, rally: false };
    msg.current = { type: 'scoreboard:live', state: JSON.parse(json), anim: null, view };
    post(fresh && anim ? { ...msg.current, anim } : msg.current);
    // A frame still loading missed that: say it again, without the stinger, when it is ready.
    const again = () => post(msg.current);
    el.addEventListener('load', again);
    return () => el.removeEventListener('load', again);
    // The stinger belongs to the play (seq), not to each repaint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, seq]);

  return <iframe ref={frame} className="ov-anim" src={`/bugs/${slug}.html?embed=1`} title="Animated scorebug" aria-hidden="true" tabIndex={-1} />;
}
