'use client';

/* eslint-disable @next/next/no-img-element -- previews of a logo that is not uploaded yet */
import { startTransition, useActionState, useEffect, useState } from 'react';
import { saveBrand } from '@/app/actions';
import { BugPreview, Matchup, Slab, TeamMark, type Brand } from '@/components/TeamBrand';
import { abbrFor } from '@/lib/format';
import { extractPalette } from '@/lib/palette';
import type { FormState, Game, Team } from '@/lib/types';

const NEUTRALS = ['#ffffff', '#0b1018', '#9aa8c2'];

// Shrink a logo in the browser: 512 px on the long side, transparency kept,
// WebP where the browser can write it (PNG where it cannot). Its colours are
// read from a 96 px copy, which is plenty for a palette.
export async function readLogo(file: File): Promise<{ blob: Blob; url: string; palette: ReturnType<typeof extractPalette> }> {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error('That file is not an image the browser can open.'));
      i.src = src;
    });
    const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512;
    const draw = (max: number) => {
      const k = Math.min(1, max / Math.max(w0, h0));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      return c;
    };
    const big = draw(512);
    const small = draw(96);
    const palette = extractPalette(small.getContext('2d')!.getImageData(0, 0, small.width, small.height).data);
    const toBlob = (type: string) => new Promise<Blob | null>((ok) => big.toBlob(ok, type, 0.92));
    let blob = await toBlob('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/png');
    if (!blob) throw new Error('That image could not be read.');
    return { blob, url: URL.createObjectURL(blob), palette };
  } finally {
    URL.revokeObjectURL(src);
  }
}

// Everything a team looks like, with the result drawn as it changes: the
// header, the slab, a matchup, and the scorebug. Upload a logo and its colours
// are picked for you; tap a swatch to change either one.
export function BrandEditor({ team, canEdit, welcome }: { team: Team; canEdit: boolean; welcome?: boolean }) {
  const [name, setName] = useState(team.name);
  const [display, setDisplay] = useState(team.display_name);
  const [abbr, setAbbr] = useState(team.abbr);
  const [age, setAge] = useState(team.age_group ?? '');
  const [color, setColor] = useState(team.color);
  const [color2, setColor2] = useState(team.color2);
  const [palette, setPalette] = useState<string[]>(team.palette ?? []);
  const [slot, setSlot] = useState<'color' | 'color2'>('color');
  const [logo, setLogo] = useState<{ blob: Blob; url: string } | null>(null);
  const [removed, setRemoved] = useState(false);
  const [readError, setReadError] = useState('');
  const [state, run, pending] = useActionState(saveBrand.bind(null, team.slug), {} as FormState);

  useEffect(() => () => { if (logo) URL.revokeObjectURL(logo.url); }, [logo]);

  const shownLogo = logo?.url ?? (removed ? null : team.logo_url);
  const brand: Brand = { name: `${name}${age ? ` ${age}` : ''}`, display: display || name || 'Team', color, color2, logo: shownLogo };
  const sample: Game = {
    sport: 'baseball', id: 'preview', team_id: team.id, season_id: null, counts_for_stats: true, opponent_team_id: null,
    opponent_name: 'Visitors', opponent_abbr: 'VIS', opponent_color: '#4b5563', is_home: true, starts_at: null,
    venue: null, status: 'scheduled', live: {},
  };

  async function pick(file: File | undefined) {
    setReadError('');
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { setReadError('That file is over 15 MB. Pick a smaller image.'); return; }
    try {
      const r = await readLogo(file);
      setLogo({ blob: r.blob, url: r.url });
      setRemoved(false);
      if (r.palette) {
        setPalette(r.palette.swatches);
        setColor(r.palette.primary);
        setColor2(r.palette.accent);
      }
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'That image could not be read.');
    }
  }

  function save() {
    const fd = new FormData();
    fd.set('name', name); fd.set('display_name', display); fd.set('abbr', abbr); fd.set('age_group', age);
    fd.set('color', color); fd.set('color2', color2); fd.set('palette', JSON.stringify(palette));
    if (logo) fd.set('logo', new File([logo.blob], logo.blob.type === 'image/webp' ? 'logo.webp' : 'logo.png', { type: logo.blob.type }));
    else if (removed) fd.set('remove_logo', '1');
    startTransition(() => run(fd));
  }

  const setSlotColor = (hex: string) => (slot === 'color' ? setColor(hex) : setColor2(hex));
  const current = slot === 'color' ? color : color2;
  const swatches = [...new Set([...palette, ...NEUTRALS])];

  return (
    <div className="stack" style={{ gap: 18 }}>
      {welcome && <p className="note note-good">Team created. Now make it look like yours: start with the logo.</p>}

      <section className="preview-stack" aria-label="Preview">
        <div className="seat" style={{ padding: 0 }}>
          <TeamMark brand={brand} size={52} />
          <span className="row-main">
            <span className="row-title" style={{ fontSize: 18 }}>{brand.name}</span>
            <span className="eyebrow">How the team header looks</span>
          </span>
        </div>
        <div style={{ borderRadius: 16, overflow: 'hidden' }}><Slab brand={brand} sub={brand.name} /></div>
        <div style={{ borderRadius: 16, overflow: 'hidden' }}><Matchup team={{ ...team, name, display_name: brand.display, color, color2, logo_url: shownLogo, age_group: age || null }} game={sample} /></div>
        <BugPreview brand={brand} />
      </section>

      {canEdit ? (
        <>
          <section className="stack" style={{ gap: 8 }}>
            <span className="legend">Logo</span>
            <label className={`drop${shownLogo ? ' has' : ''}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onChange={(e) => pick(e.currentTarget.files?.[0])} />
              {shownLogo ? <img src={shownLogo} alt="" style={{ width: 64, height: 64, objectFit: 'contain' }} /> : <TeamMark brand={brand} size={64} />}
              <span className="row-main">
                <span className="row-title">{shownLogo ? 'Change the logo' : 'Upload your logo'}</span>
                <span className="row-meta">PNG with a clear background looks best. Its colours fill in below.</span>
              </span>
            </label>
            {readError && <p role="alert" className="note note-bad">{readError}</p>}
            {shownLogo && (
              <button type="button" className="link" style={{ alignSelf: 'flex-start' }} onClick={() => { setLogo(null); setRemoved(true); }}>Remove the logo</button>
            )}
          </section>

          <section className="stack" style={{ gap: 10 }}>
            <span className="legend">Colours{palette.length ? ' · from your logo' : ''}</span>
            <div className="slots">
              <button type="button" className="slot" aria-pressed={slot === 'color'} onClick={() => setSlot('color')}>
                <i style={{ background: color }} /><span>Primary<b>{color}</b></span>
              </button>
              <button type="button" className="slot" aria-pressed={slot === 'color2'} onClick={() => setSlot('color2')}>
                <i style={{ background: color2 }} /><span>Accent<b>{color2}</b></span>
              </button>
            </div>
            <div className="swatches" role="group" aria-label={`Pick the ${slot === 'color' ? 'primary' : 'accent'} colour`}>
              {swatches.map((hex) => (
                <button key={hex} type="button" className={`swatch${current.toLowerCase() === hex.toLowerCase() ? ' on' : ''}`}
                  style={{ background: hex }} aria-label={hex} onClick={() => setSlotColor(hex)} />
              ))}
              <label className="swatch" style={{ position: 'relative', overflow: 'hidden', background: 'conic-gradient(#e5534b, #e0a92a, #35d07f, #6ea8f0, #a06ef0, #e5534b)' }} title="Any colour">
                <input type="color" value={current} onChange={(e) => setSlotColor(e.currentTarget.value)} aria-label="Any colour"
                  style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
              </label>
            </div>
          </section>

          <section className="form">
            <label className="field"><span>Display name · on the scorebug, up to 24</span>
              <input className="input" value={display} maxLength={24} onChange={(e) => setDisplay(e.currentTarget.value)} autoComplete="off" />
            </label>
            <label className="field"><span>Full team name</span>
              <input className="input" value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" />
            </label>
            <div className="field-row">
              <label className="field"><span>Age group</span>
                <input className="input" value={age} maxLength={12} placeholder="14U" onChange={(e) => setAge(e.currentTarget.value)} autoComplete="off" />
              </label>
              <label className="field"><span>Short code · tight spots</span>
                <input className="input" value={abbr} maxLength={6} placeholder={abbrFor(display)} autoCapitalize="characters"
                  onChange={(e) => setAbbr(e.currentTarget.value.toUpperCase())} autoComplete="off" />
              </label>
            </div>
          </section>

          <div className="save-bar">
            <span className="sub" role="status">
              {state.error ? <span className="bad">{state.error}</span> : pending ? 'Saving…' : state.ok ?? 'Changes show in the preview first'}
            </span>
            <button type="button" className="btn btn-primary" onClick={save} disabled={pending}>Save look</button>
          </div>
        </>
      ) : (
        <p className="note note-plain">The organizer or head coach sets the logo, colours and names.</p>
      )}
    </div>
  );
}
