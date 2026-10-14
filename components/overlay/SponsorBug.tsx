'use client';
/* eslint-disable @next/next/no-img-element -- sponsor logos are small images shown at a fixed size */

import { useEffect, useState } from 'react';
import type { Broadcast } from '@/lib/broadcast';

// v4's sponsor rotation: a corner bug, "Brought to you by", that comes up every
// few minutes for eight seconds and leaves again, one sponsor after the next.
// It waits while a full-frame scene is up.
export function SponsorBug({ sponsors, hold }: { sponsors: Broadcast['sponsors']; hold: boolean }) {
  const list = (sponsors?.items ?? []).filter((x) => x && (x.name || x.logo));
  const on = !!sponsors?.on && list.length > 0;
  const every = Math.max(30, Number(sponsors?.every) || 180) * 1000;
  const [i, setI] = useState(-1);
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (!on) return;
    let hide = 0;
    const show = () => { setI((x) => x + 1); setUp(true); hide = window.setTimeout(() => setUp(false), 8000); };
    const first = window.setTimeout(show, 5000);
    const t = window.setInterval(show, every);
    return () => { window.clearTimeout(first); window.clearInterval(t); window.clearTimeout(hide); };
  }, [on, every]);
  if (!on || i < 0) return null;
  const sp = list[i % list.length];
  return (
    <div className={`ov-spbug${up && !hold ? ' on' : ''}`} aria-hidden={!up}>
      <small>Brought to you by</small>
      {sp.logo && <img src={sp.logo} alt="" />}
      {sp.name && <b>{sp.name}</b>}
    </div>
  );
}
