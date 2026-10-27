'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { setRsvp } from '@/app/hub-actions';
import type { RsvpStatus } from '@/lib/types';

const CHOICES: { v: RsvpStatus; label: string }[] = [{ v: 'yes', label: 'Going' }, { v: 'maybe', label: 'Maybe' }, { v: 'no', label: 'Can’t make it' }];

// A parent's answer for each of their players, one tap each. The tap shows at
// once and is saved behind it; tapping the answer already chosen clears it.
export function Rsvp({ slug, item, players, answers }: {
  slug: string; item: { game?: string; event?: string }; players: { id: string; name: string }[]; answers: Record<string, RsvpStatus>;
}) {
  const [shown, set] = useOptimistic(answers, (cur, [id, v]: [string, RsvpStatus | null]) => {
    const next = { ...cur };
    if (v) next[id] = v; else delete next[id];
    return next;
  });
  const [, start] = useTransition();
  const [error, setError] = useState('');
  return (
    <div className="stack" style={{ gap: 8 }}>
      {players.map((p) => (
        <div key={p.id} className="rsvp">
          {players.length > 1 && <span className="row-meta">{p.name}</span>}
          <div className="pills" role="group" aria-label={`${p.name}: coming?`}>
            {CHOICES.map((c) => {
              const on = shown[p.id] === c.v;
              return (
                <button key={c.v} type="button" className={`rsvp-btn ${c.v}${on ? ' on' : ''}`} aria-pressed={on}
                  onClick={() => start(async () => {
                    set([p.id, on ? null : c.v]);
                    const r = await setRsvp(slug, item, p.id, on ? null : c.v);
                    setError(r.error ?? '');
                  })}>
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {error && <p role="alert" className="note note-bad">{error}</p>}
    </div>
  );
}
