'use client';

import { useRef, useState } from 'react';

// Shrink a photo to at most 1600 px on its longer side, as JPEG, so it sends
// quickly on ballpark signal and stays well under the server's size limit.
async function shrink(file: File): Promise<{ data: string; type: string }> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { data: url.slice(url.indexOf(',') + 1), type: 'image/jpeg' };
}

// Read a lineup card from a photo into the paste box: the scorer checks the
// lines there, then taps Add these. Nothing is added or saved on its own.
export function PhotoLineup({ gameId, side, onLines }: { gameId: string; side: 'us' | 'them'; onLines: (text: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsure, setUnsure] = useState<string[]>([]);

  async function read(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(null); setUnsure([]);
    try {
      const { data, type } = await shrink(file);
      const res = await fetch('/api/ai/lineup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameId, side, image: data, mediaType: type }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Could not read that photo.'); return; }
      if (!body.lines?.length) { setError('No batters found in that photo.'); setUnsure(body.unsure ?? []); return; }
      onLines((body.lines as string[]).join('\n'));
      setUnsure(body.unsure ?? []);
    } catch {
      setError('Could not read that photo. Check your signal and try again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={(e) => read(e.currentTarget.files?.[0])} />
      <button type="button" className="btn btn-quiet" onClick={() => input.current?.click()} disabled={busy} aria-busy={busy}>
        {busy ? 'Reading the photo…' : 'Read a lineup card photo'}
      </button>
      {error && <p role="alert" className="note note-bad">{error}</p>}
      {unsure.length > 0 && <p className="note note-plain">Check: {unsure.join('; ')}</p>}
    </div>
  );
}
