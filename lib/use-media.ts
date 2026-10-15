'use client';

import { useSyncExternalStore } from 'react';

// Whether a media query matches, kept current as the window turns or resizes.
// On the server, and on the first paint, it is false: the phone layout.
const subscribers = new Map<string, (cb: () => void) => () => void>();
function subscribe(query: string) {
  let s = subscribers.get(query);
  if (!s) {
    s = (cb) => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };
    subscribers.set(query, s);
  }
  return s;
}
export function useMedia(query: string) {
  return useSyncExternalStore(subscribe(query), () => window.matchMedia(query).matches, () => false);
}

// The pad's console (On Air beside or under the keys): any tablet, and up.
export const CONSOLE = '(min-width: 768px) and (min-height: 600px)';
