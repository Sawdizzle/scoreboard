'use client';
/* eslint-disable @next/next/no-img-element -- a small logo preview */

import { startTransition, useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteOpponent, saveOpponent } from '@/app/actions';
import { readLogo } from '@/components/BrandEditor';
import { Cross, Plus } from '@/components/icons';
import { BugPreview, TeamMark, type Brand } from '@/components/TeamBrand';
import { FIELD } from '@/lib/lineup';
import { parseRoster } from '@/lib/roster-parse';
import { newBid } from '@/lib/rules/roster.js';
import type { SavedOpponent } from '@/lib/data';
import type { FormState } from '@/lib/types';

type Row = { bid: string; num: string; name: string; pos: string };
const NEUTRALS = ['#ffffff', '#0b1018', '#9aa8c2', '#7a8794'];

// One opponent, the way the stream and the pad will show them: the logo (its
// colors are read from it), the two colors, the name and short code, and the
// roster that loads into their lineup for each game against them. A position
// here is where they usually play; the lineup screen can move anyone on the day.
export function OpponentEditor({ slug, opponent }: { slug: string; opponent: SavedOpponent }) {
  const router = useRouter();
  const [name, setName] = useState(opponent.name);
  const [abbr, setAbbr] = useState(opponent.abbr);
  const [color, setColor] = useState(opponent.color);
  const [color2, setColor2] = useState(opponent.color2 ?? '#f2f6fc');
  const [palette, setPalette] = useState<string[]>([]);
  const [slot, setSlot] = useState<'color' | 'color2'>('color');
  const [logo, setLogo] = useState<{ blob: Blob; url: string } | null>(null);
  const [removed, setRemoved] = useState(false);
  const [readError, setReadError] = useState('');
  const [rows, setRows] = useState<Row[]>(() => {
    const at = new Map(Object.entries(opponent.roster?.positions ?? {}).map(([pos, bid]) => [bid, pos]));
    return (opponent.roster?.batters ?? []).map((b) => ({ bid: b.bid, num: b.num, name: b.name, pos: at.get(b.bid) ?? '' }));
  });
  const [paste, setPaste] = useState('');
  const [state, run, pending] = useActionState(saveOpponent.bind(null, slug, opponent.id), {} as FormState);
  useEffect(() => () => { if (logo) URL.revokeObjectURL(logo.url); }, [logo]);

  const shownLogo = logo?.url ?? (removed ? null : opponent.logo_url);
  const brand: Brand = { name, display: name || 'Opponent', color, color2, logo: shownLogo };

  async function pick(file: File | undefined) {
    setReadError('');
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setReadError('That file is over 15 MB. Pick a smaller image.'); return; }
    try {
      const r = await readLogo(file);
      setLogo({ blob: r.blob, url: r.url });
      setRemoved(false);
      if (r.palette) { setPalette(r.palette.swatches); setColor(r.palette.primary); setColor2(r.palette.accent); }
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'That image could not be read.');
    }
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  function addPasted() {
    const list = parseRoster(paste);
    if (!list.length) return;
    setRows([...rows, ...list.map((p) => ({ bid: newBid(), num: p.number, name: `${p.first_name} ${p.last_name}`.trim(), pos: p.positions.find((x) => FIELD.includes(x)) ?? '' }))]);
    setPaste('');
  }

  function save() {
    const kept = rows.filter((r) => r.num.trim() || r.name.trim()).map((r) => ({ ...r, num: r.num.replace(/\D/g, '').slice(0, 3), name: r.name.trim().slice(0, 60) }));
    const positions: Record<string, string> = {};
    for (const r of kept) if (r.pos && !positions[r.pos]) positions[r.pos] = r.bid;
    const fd = new FormData();
    fd.set('name', name.trim()); fd.set('abbr', abbr); fd.set('color', color); fd.set('color2', color2);
    fd.set('roster', JSON.stringify({ batters: kept.map(({ bid, num, name: n }) => ({ bid, num, name: n })), positions }));
    if (logo) fd.set('logo', new File([logo.blob], logo.blob.type === 'image/webp' ? 'logo.webp' : 'logo.png', { type: logo.blob.type }));
    else if (removed) fd.set('remove_logo', '1');
    startTransition(() => run(fd));
  }
  async function remove() {
    if (!window.confirm(`Take ${opponent.name} off your list? Games already played keep their score and lineups.`)) return;
    const r = await deleteOpponent(slug, opponent.id, {});
    if (r.ok) router.push(`/t/${slug}/opponents`);
  }

  const current = slot === 'color' ? color : color2;
  const setSlotColor = (hex: string) => (slot === 'color' ? setColor(hex) : setColor2(hex));
  const swatches = [...new Set([...palette, ...NEUTRALS])];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <section className="preview-stack" aria-label="Preview">
        <div className="seat" style={{ padding: 0 }}>
          <TeamMark brand={brand} size={52} />
          <span className="row-main"><span className="row-title" style={{ fontSize: 18 }}>{name || 'Opponent'}</span><span className="eyebrow">On the pad and the stream</span></span>
        </div>
        <BugPreview brand={brand} />
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <span className="legend">Logo</span>
        <label className={`drop${shownLogo ? ' has' : ''}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={(e) => pick(e.currentTarget.files?.[0])} />
          {shownLogo ? <img src={shownLogo} alt="" style={{ width: 64, height: 64, objectFit: 'contain' }} /> : <TeamMark brand={brand} size={64} />}
          <span className="row-main">
            <span className="row-title">{shownLogo ? 'Change the logo' : 'Upload their logo'}</span>
            <span className="row-meta">A PNG with a clear background looks best. Its colors fill in below.</span>
          </span>
        </label>
        {readError && <p role="alert" className="note note-bad">{readError}</p>}
        {shownLogo && <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => { setLogo(null); setRemoved(true); }}>Remove the logo</button>}
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <span className="legend">Colors{palette.length ? ' · from the logo' : ''}</span>
        <div className="slots">
          <button type="button" className="slot" aria-pressed={slot === 'color'} onClick={() => setSlot('color')}><i style={{ background: color }} /><span>Primary<b>{color}</b></span></button>
          <button type="button" className="slot" aria-pressed={slot === 'color2'} onClick={() => setSlot('color2')}><i style={{ background: color2 }} /><span>Accent<b>{color2}</b></span></button>
        </div>
        <div className="swatches" role="group" aria-label={`Pick the ${slot === 'color' ? 'primary' : 'accent'} color`}>
          {swatches.map((hex) => (
            <button key={hex} type="button" className={`swatch${current.toLowerCase() === hex.toLowerCase() ? ' on' : ''}`} style={{ background: hex }} aria-label={hex} onClick={() => setSlotColor(hex)} />
          ))}
          <label className="swatch" style={{ position: 'relative', overflow: 'hidden', background: 'conic-gradient(#e5534b, #e0a92a, #35d07f, #6ea8f0, #a06ef0, #e5534b)' }} title="Any color">
            <input type="color" value={current} onChange={(e) => setSlotColor(e.currentTarget.value)} aria-label="Any color" style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          </label>
        </div>
      </section>

      <section className="form">
        <div className="field-row" style={{ gridTemplateColumns: '1fr 110px' }}>
          <label className="field"><span>Name</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" /></label>
          <label className="field"><span>Short code</span><input className="input" value={abbr} maxLength={6} autoCapitalize="characters" onChange={(e) => setAbbr(e.currentTarget.value.toUpperCase())} autoComplete="off" /></label>
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="col-head"><span style={{ flex: 1 }}>Roster · {rows.filter((r) => r.num || r.name).length}</span><span>loads into their lineup each game</span></div>
        {rows.length === 0 && <div className="card empty"><b>No players yet</b>Add them one at a time, or paste their list below.</div>}
        {rows.map((r, i) => (
          <div key={r.bid} className="opp-row">
            <input className="input num" value={r.num} inputMode="numeric" maxLength={3} placeholder="#" aria-label="Number" onChange={(e) => setRow(i, { num: e.currentTarget.value.replace(/\D/g, '') })} />
            <input className="input" value={r.name} maxLength={60} placeholder="Name" aria-label="Name" onChange={(e) => setRow(i, { name: e.currentTarget.value })} />
            <select className="select pos" value={r.pos} aria-label="Usual position" onChange={(e) => setRow(i, { pos: e.currentTarget.value })}>
              <option value="">Pos</option>{FIELD.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button type="button" className="icon-btn sm" aria-label={`Remove ${r.name || r.num || 'player'}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Cross size={14} /></button>
          </div>
        ))}
        <button type="button" className="btn btn-quiet" onClick={() => setRows([...rows, { bid: newBid(), num: '', name: '', pos: '' }])}><Plus size={14} /> Add a player</button>
        <details className="fold">
          <summary><span className="plus"><Plus /></span>Paste a list</summary>
          <div className="fold-body stack">
            <textarea className="textarea" value={paste} onChange={(e) => setPaste(e.currentTarget.value)} placeholder={'7 Ava Reyes SS\n12 Ben Ortiz P\n21'} style={{ minHeight: 110 }} />
            <button type="button" className="btn btn-quiet" onClick={addPasted} disabled={!paste.trim()}>Add these</button>
          </div>
        </details>
      </section>

      <div className="save-bar">
        <span className="sub" role="status">{state.error ? <span className="bad">{state.error}</span> : pending ? 'Saving…' : state.ok ?? ''}</span>
        <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>Save</button>
      </div>
      <button type="button" className="link" style={{ alignSelf: 'center', color: 'var(--bad-text)' }} onClick={remove}>Take {opponent.name} off the list</button>
    </div>
  );
}
