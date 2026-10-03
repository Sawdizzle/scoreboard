'use client';
/* eslint-disable @next/next/no-img-element -- small fixed thumbnails from /public */

import { useEffect, useMemo, useRef, useState } from 'react';
import { resetStreamLink, saveSponsor, saveStreamBug } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { CopyLink } from '@/components/CopyLink';
import { BugPreview, brandOf } from '@/components/TeamBrand';
import { demoFeed } from '@/lib/demo-feed';
import { BUG_SCALE, CARD_SCALE, LOOKS, QR_OPACITY, QR_SIZE, layoutOf, qrLayer, type BugPos, type CardKind, type Feed, type Layout, type Look, type QrLayer, type QrPos } from '@/lib/onair';
import { browserClient } from '@/lib/supabase/browser';
import type { Team } from '@/lib/types';

export type StreamChannel = {
  look: Look; layout: Feed['layout']; qr: Feed['qr']; show_line: boolean;
  bug_text: string | null; bug_url: string | null; sponsor_name: string | null; sponsor_line: string | null; sponsor_logo: string | null;
};

const BUG_AT: [BugPos, string][] = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];
const QR_AT: (QrPos | null)[] = ['tl', 'tc', 'tr', 'ml', null, 'mr', 'bl', 'bc', 'br'];
const QR_LABEL: Record<QrPos, string> = { tl: 'Top left', tc: 'Top centre', tr: 'Top right', ml: 'Middle left', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom centre', br: 'Bottom right' };
const CARDS: [CardKind | null, string][] = [[null, 'No card'], ['batter', 'Batter'], ['pitcher', 'Pitcher'], ['dueup', 'Due up'], ['leaders', 'Leaders'], ['box', 'Box score'],
  ['lineup', 'Lineup'], ['defense', 'Defense'], ['matchup', 'Matchup'], ['mid', 'Mid-inning'], ['sponsor', 'Sponsor']];
const pct = (v: number) => `${Math.round(v * 100)}%`;

// The one place the stream's look is set: which scorebug, how big and where,
// the cards' size, the QR code, the corner line and the sponsor. The preview
// at the top is the real overlay drawing a made-up game, and it follows every
// control as it moves. What is on air right now is the pad's On Air, not this.
export function StreamSetup({ team, channel, streamUrl, canLead }: { team: Team; channel: StreamChannel; streamUrl: string; canLead: boolean }) {
  const [look, setLook] = useState(channel.look);
  const [lay, setLay] = useState<Layout>(() => layoutOf(channel.layout));
  const [qr, setQr] = useState<QrLayer>(() => qrLayer(channel.qr));
  const [bugText, setBugText] = useState(channel.bug_text ?? '');
  const [bugUrl, setBugUrl] = useState(channel.bug_url ?? '');
  const [card, setCard] = useState<CardKind | null>(null);
  const [error, setError] = useState('');
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef(0);

  // Look, layout and the QR code save themselves, a moment after the last change.
  const save = (patch: object) => {
    setError('');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const { error: e } = await browserClient().from('channels').update(patch).eq('team_id', team.id);
      if (e) setError('That did not save. Check your signal and try again.');
    }, 300);
  };
  const pickLook = (l: Look) => { setLook(l); save({ look: l, layout: lay, qr }); };
  const moveLay = (l: Layout) => { setLay(l); save({ look, layout: l, qr }); };
  const moveQr = (q: QrLayer) => { setQr(q); save({ look, layout: lay, qr: q }); };

  const link = /^https:\/\/\S+\.\S+/.test(bugUrl.trim()) ? bugUrl.trim() : /^[\w-]+(\.[\w-]+)+/.test(bugUrl.trim()) ? `https://${bugUrl.trim()}` : null;
  const feed = useMemo(() => demoFeed(team, {
    look, layout: lay, show_line: channel.show_line,
    // In the preview the code is always up, so it can be placed; on air it is a switch.
    qr: { ...qr, on: !!link },
    bug: bugText.trim() || link ? { text: bugText.trim() || null, url: link } : null,
    sponsor: channel.sponsor_name ? { name: channel.sponsor_name, line: channel.sponsor_line, logo: channel.sponsor_logo } : null,
  }), [team, look, lay, qr, bugText, link, channel.show_line, channel.sponsor_name, channel.sponsor_line, channel.sponsor_logo]);

  useEffect(() => {
    const post = () => frame.current?.contentWindow?.postMessage({ type: 'pb:demo', feed, card }, window.location.origin);
    post();
    const onMessage = (e: MessageEvent) => { if (e.origin === window.location.origin && (e.data as { type?: string } | null)?.type === 'pb:demo-ready') post(); };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [feed, card]);

  // The preview is the overlay at 1280 wide, scaled to the box: the same pixels as the stream, only smaller.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => el.style.setProperty('--k', String(el.clientWidth / 1280));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="page stream">
      <div className="stream-prev" ref={box}>
        <iframe ref={frame} src="/overlay/demo" title="Stream preview" tabIndex={-1} />
        <span>Preview · made-up game</span>
      </div>
      <div className="chips-row" role="radiogroup" aria-label="Card shown in the preview">
        {CARDS.filter(([k]) => k !== 'sponsor' || channel.sponsor_name).map(([k, label]) => (
          <button key={label} type="button" role="radio" aria-checked={card === k} className={`chip${card === k ? ' on' : ''}`} onClick={() => setCard(k)}>{label}</button>
        ))}
      </div>
      {error && <p className="note note-bad" role="alert">{error}</p>}

      <section className="card pad">
        <h2>Scorebug</h2>
        <div className="looks" role="radiogroup" aria-label="Scorebug look">
          {LOOKS.map(([slug, name]) => (
            <button key={slug} type="button" role="radio" aria-checked={look === slug} className={`look${look === slug ? ' on' : ''}`} onClick={() => pickLook(slug)}>
              <span className="look-thumb">{slug === 'pressbox' || slug === 'classic' ? <BugPreview brand={brandOf(team)} /> : <img src={`/bugs/thumbs/${slug}.png`} alt="" loading="lazy" />}</span>
              <b>{name}</b>
            </button>
          ))}
        </div>
        <div className="air-autos air-qr">
          <label className="air-slide" style={{ borderTop: 0 }}><span>Size<b>{pct(lay.bug.scale)}</b></span>
            <input type="range" min={BUG_SCALE.min} max={BUG_SCALE.max} step={0.05} value={lay.bug.scale} onChange={(e) => moveLay({ ...lay, bug: { ...lay.bug, scale: Number(e.target.value) } })} />
          </label>
          <div className="air-pos two" role="radiogroup" aria-label="Where the scorebug sits">
            {BUG_AT.map(([p, label]) => (
              <button key={p} type="button" role="radio" aria-checked={lay.bug.pos === p} aria-label={label} className={lay.bug.pos === p ? 'on' : undefined} onClick={() => moveLay({ ...lay, bug: { ...lay.bug, pos: p } })} />
            ))}
            <small>{BUG_AT.find(([p]) => p === lay.bug.pos)![1]}</small>
          </div>
        </div>
      </section>

      <section className="card pad">
        <h2>Stat cards</h2>
        <p className="hint">Pick a card above to see it. Cards are raised and cleared from On Air in the pad.</p>
        <div className="air-autos air-qr">
          <label className="air-slide" style={{ borderTop: 0 }}><span>Size<b>{pct(lay.cards.scale)}</b></span>
            <input type="range" min={CARD_SCALE.min} max={CARD_SCALE.max} step={0.05} value={lay.cards.scale} onChange={(e) => moveLay({ ...lay, cards: { scale: Number(e.target.value) } })} />
          </label>
        </div>
      </section>

      <section className="card pad">
        <h2>Channel bug and QR code</h2>
        <p className="hint">The line stays in a corner of the stream all game. The link becomes a QR code, switched on and off from On Air in the pad.</p>
        {canLead ? (
          <ActionForm action={saveStreamBug.bind(null, team.slug)} className="form">
            <label className="field"><span>Line in the corner</span>
              <input className="input" name="bug_text" value={bugText} onChange={(e) => setBugText(e.target.value)} maxLength={40} autoComplete="off" placeholder="Streamed by sawman.app" />
            </label>
            <label className="field"><span>Link for the QR code</span>
              <input className="input" name="bug_url" value={bugUrl} onChange={(e) => setBugUrl(e.target.value)} maxLength={200} autoComplete="off" inputMode="url" placeholder="sawman.app" />
            </label>
            <Submit busy="Saving…">Save line and link</Submit>
          </ActionForm>
        ) : <p className="note note-plain">An organizer or head coach sets the line and the link.</p>}
        {link && (
          <div className="air-autos air-qr">
            <label className="air-slide" style={{ borderTop: 0 }}><span>QR size<b>{Math.round((qr.size / 128) * 100)}% of the width</b></span>
              <input type="range" min={QR_SIZE.min} max={QR_SIZE.max} step={1} value={qr.size} onChange={(e) => moveQr({ ...qr, size: Number(e.target.value) })} />
            </label>
            <label className="air-slide"><span>QR opacity<b>{pct(qr.opacity)}</b></span>
              <input type="range" min={QR_OPACITY.min} max={QR_OPACITY.max} step={0.05} value={qr.opacity} onChange={(e) => moveQr({ ...qr, opacity: Number(e.target.value) })} />
            </label>
            <div className="air-pos" role="radiogroup" aria-label="Where the QR code sits">
              {QR_AT.map((p, i) => p
                ? <button key={p} type="button" role="radio" aria-checked={qr.pos === p} aria-label={QR_LABEL[p]} className={qr.pos === p ? 'on' : undefined} onClick={() => moveQr({ ...qr, pos: p })} />
                : <span key={i} />)}
              <small>{QR_LABEL[qr.pos]}</small>
            </div>
          </div>
        )}
      </section>

      {canLead && (
        <section className="card pad">
          <h2>Sponsor</h2>
          <ActionForm action={saveSponsor.bind(null, team.slug)} className="form">
            <p className="hint">A card raised from On Air: &ldquo;Brought to you by&rdquo;, the logo, the name and a line under it. Clear the name to remove it.</p>
            <label className="field"><span>Sponsor name</span>
              <input className="input" name="sponsor_name" defaultValue={channel.sponsor_name ?? ''} maxLength={40} autoComplete="off" />
            </label>
            <label className="field"><span>Line under it</span>
              <input className="input" name="sponsor_line" defaultValue={channel.sponsor_line ?? ''} maxLength={60} autoComplete="off" placeholder="Cold treats on Elm Street" />
            </label>
            <label className="field"><span>Logo (PNG, WebP or JPEG, under 1 MB)</span>
              <input className="input" type="file" name="sponsor_logo" accept="image/png,image/webp,image/jpeg" />
            </label>
            {channel.sponsor_logo && <label className="switch"><span className="switch-text"><b>Remove the current logo</b></span><input type="checkbox" name="remove_sponsor_logo" /></label>}
            <Submit busy="Saving…">Save sponsor</Submit>
          </ActionForm>
        </section>
      )}

      <section className="card pad">
        <h2>Browser Source link</h2>
        <p className="hint">Add this link to OBS (or any streaming software) as a Browser Source, 1920 wide by 1080 high. It shows the game being scored on the pad, with a clear background. Anyone with the link can watch the scorebug.</p>
        <CopyLink url={streamUrl} label="Browser Source link" />
        {canLead && (
          <details className="fold danger">
            <summary>Make a new link</summary>
            <div className="fold-body">
              <ActionForm action={resetStreamLink.bind(null, team.slug)} className="form">
                <p className="hint">For when the link has got out. The old link stops working at once, and OBS shows nothing until you paste in the new one.</p>
                <Submit className="btn btn-danger" busy="Making…">Make a new link</Submit>
              </ActionForm>
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
