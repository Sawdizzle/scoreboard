'use client';
/* eslint-disable @next/next/no-img-element -- small fixed thumbnails from /public */

import { useState } from 'react';
import { BugPreview, type Brand } from '@/components/TeamBrand';
import { LOOKS, type Look } from '@/lib/onair';
import { browserClient } from '@/lib/supabase/browser';

// The scorebug's look, picked once for the stream: Pressbox's own, which
// carries the batter's season line, or one of Scoreboard's animated bugs.
// A tap is the change; the stream follows within a few seconds.
export function LookPicker({ teamId, brand, initial }: { teamId: string; brand: Brand; initial: Look }) {
  const [look, setLook] = useState(initial);
  const [error, setError] = useState('');
  async function pick(next: Look) {
    const before = look;
    setLook(next);
    setError('');
    const { error: e } = await browserClient().from('channels').update({ look: next }).eq('team_id', teamId);
    if (e) { setLook(before); setError('That look did not save. Try again.'); }
  }
  return (
    <>
      <div className="looks" role="radiogroup" aria-label="Scorebug look">
        {LOOKS.map(([slug, name]) => (
          <button key={slug} type="button" role="radio" aria-checked={look === slug} className={`look${look === slug ? ' on' : ''}`} onClick={() => pick(slug)}>
            <span className="look-thumb">{slug === 'pressbox' || slug === 'classic' ? <BugPreview brand={brand} /> : <img src={`/bugs/thumbs/${slug}.png`} alt="" loading="lazy" />}</span>
            <b>{name}</b>
          </button>
        ))}
      </div>
      {error && <p className="note note-bad" role="alert">{error}</p>}
    </>
  );
}
