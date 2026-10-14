'use client';

import { useEffect, useState } from 'react';

// A time in the reader's own time zone. The server does not know it, so the
// server writes the date alone and the browser fills in the rest; the first
// paint and the hydrated one may differ, which is expected here.
export function LocalTime({ iso, mode = 'full' }: { iso: string | null; mode?: 'full' | 'time' | 'day' }) {
  const [text, setText] = useState(() => (iso ? iso.slice(0, 10) : 'No time set'));
  useEffect(() => {
    if (!iso) return;
    const d = new Date(iso);
    const day = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's zone is only known here
    setText(mode === 'time' ? time : mode === 'day' ? day : `${day} · ${time}`);
  }, [iso, mode]);
  return <time dateTime={iso ?? undefined} suppressHydrationWarning>{text}</time>;
}

// A date and time picker that hands the server an exact moment. The picker
// itself has no time zone; this adds the browser's before the form is sent.
export function DateTimeField({ name, value, label }: { name: string; value: string | null; label: string }) {
  const toLocal = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const [local, setLocal] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the browser's zone is only known here
    if (value) setLocal(toLocal(value));
  }, [value]);
  const iso = local ? new Date(local).toISOString() : '';
  return (
    <label className="field"><span>{label}</span>
      <input className="input" type="datetime-local" value={local} onChange={(e) => setLocal(e.currentTarget.value)} />
      <input type="hidden" name={name} value={iso} />
    </label>
  );
}
