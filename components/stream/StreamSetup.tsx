'use client';
/* eslint-disable @next/next/no-img-element -- small fixed thumbnails from /public */

import { useEffect, useMemo, useRef, useState } from 'react';
import { resetStreamLink, saveSponsor, saveStreamBug } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { CopyLink } from '@/components/CopyLink';
import { BugPreview, brandOf } from '@/components/TeamBrand';
import { demoFeed } from '@/lib/demo-feed';
import { BUG_SCALE, CARD_SCALE, LOOKS, QR_OPACITY, QR_SIZE, layoutOf, qrLayer, type BugPos, type CardKind, type Feed, type Layout, type Look, type QrLayer, type QrPos } from '@/lib/onair';
import { mergeBroadcast, type Broadcast, type BroadcastPatch } from '@/lib/broadcast';
import { browserClient } from '@/lib/supabase/browser';
import type { Team } from '@/lib/types';

export type StreamChannel = {
  look: Look; layout: Feed['layout']; qr: Feed['qr']; show_line: boolean; broadcast?: Broadcast | null;
  bug_text: string | null; bug_url: string | null; sponsor_name: string | null; sponsor_line: string | null; sponsor_logo: string | null;
};

const BUG_AT: [BugPos, string][] = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['ml', 'Middle left'], ['mc', 'Middle'], ['mr', 'Middle right'],
  ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];
const QR_AT: (QrPos | null)[] = ['tl', 'tc', 'tr', 'ml', null, 'mr', 'bl', 'bc', 'br'];
const QR_LABEL: Record<QrPos, string> = { tl: 'Top left', tc: 'Top centre', tr: 'Top right', ml: 'Middle left', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom centre', br: 'Bottom right' };
const CARDS: [CardKind | null, string][] = [[null, 'No card'], ['batter', 'Batter'], ['pitcher', 'Pitcher'], ['dueup', 'Due up'], ['leaders', 'Leaders'], ['box', 'Box score'],
  ['lineup', 'Lineup'], ['defense', 'Defense'], ['matchup', 'Matchup'], ['mid', 'Mid-inning'], ['sponsor', 'Sponsor']];
const pct = (v: number) => `${Math.round(v * 100)}%`;
// v4's five sound packs, every sound synthesized (lib/fx/audio.js).
const PACKS: [string, string][] = [['bigleague', 'Big League organ'], ['modern', 'Modern'], ['sandlot', 'Sandlot 8-bit'], ['airhorn', 'Stadium air horns'], ['organ', 'Pipe organ']];
// v4's themes and layouts for Scoreboard's own bug (components/overlay/themes.css).
const THEMES: [string, [string, string][]][] = [
  ['Your own', [['custom', 'Custom (your colours)'], ['bluesteel', 'Blue Steel'], ['forever20', 'Forever 20 (purple & gold)']]],
  ['Clean', [['nightgame', 'Midnight'], ['espn', 'Broadcast Minimal'], ['green', 'Ballpark Green'], ['carbon', 'Carbon'], ['royal', 'Royal'], ['gold', 'Gold'], ['ice', 'Ice (light)']]],
  ['Bold', [['neon', 'Neon'], ['volt', 'Volt (electric)'], ['blueprint', 'Blueprint'], ['foil', 'Holo Foil (refractor)'], ['jumbotron', 'Jumbotron (LED)']]],
  ['Throwback', [['retro', 'Retro 8-bit'], ['chalkboard', 'Sandlot Slate'], ['americana', 'Americana (bunting)']]],
];
const STYLES: [string, string][] = [['bar', 'Bar (wide strip)'], ['scorebox', 'Scorebox (full broadcast)'], ['bug', 'Bug (stacked)'], ['minimal', 'Minimal (slim)'], ['lowerthird', 'Lower-third']];
const SHOWS: [keyof NonNullable<Broadcast['show']>, string, string, boolean][] = [
  ['clock', 'Game clock', 'Time limit, quarter or half', true], ['batter', 'Batter', 'The name on the strip', true], ['pitcher', 'Pitcher', 'The name on the strip', true],
  ['pitchcount', 'Pitch count', 'Beside the pitcher', true], ['rhe', 'Hits and errors', 'Beside each score', false], ['runrule', 'Run rule', 'A badge when the lead reaches it', true],
];

// Every moment the stream can play, for a run-through from here.
const ALL_FX = ['run', 'homerun', 'strikeout', 'doubleplay', 'stolenbase', 'walkoff', 'charge', 'touchdown', 'fieldgoal', 'turnover', 'goal', 'three', 'ace', 'bigplay'];

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
  const [bc, setBc] = useState<Broadcast>(channel.broadcast ?? {});
  const [running, setRunning] = useState(false);
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
  // The broadcast settings (sound, and later the theme, scenes, ticker) merge
  // key by key on the server, so two people changing different things do not
  // undo each other.
  const btimer = useRef(0);
  const pending = useRef<BroadcastPatch>({});
  const setB = (patch: BroadcastPatch) => {
    setBc((b) => mergeBroadcast(b, patch));
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(btimer.current);
    btimer.current = window.setTimeout(async () => {
      const p = pending.current; pending.current = {};
      const { error: e } = await browserClient().rpc('set_broadcast', { p_team: team.id, p_patch: p });
      if (e) setError('That did not save. Check your signal and try again.');
    }, 300);
  };
  const sound = bc.sound ?? {};
  const setSound = (patch: NonNullable<Broadcast['sound']>) => setB({ sound: { ...sound, ...patch } });
  const send = (kind: string) => browserClient().rpc('send_cmd', { p_team: team.id, p_cmd: { type: 'moment', kind } });
  async function runThrough() {
    setRunning(true);
    for (const k of ALL_FX) { await send(k); await new Promise((r) => setTimeout(r, 5500)); }
    setRunning(false);
  }
  const show = bc.show ?? {};
  const custom = bc.custom ?? {};
  const setCustom = (k: string, v: string | number | boolean) => setB({ custom: { ...custom, [k]: v } });
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
    // The preview shows the look, never a scene or the ticker: those are for air.
    broadcast: { ...bc, scene: null, ticker: undefined },
  }), [team, look, lay, qr, bugText, link, bc, channel.show_line, channel.sponsor_name, channel.sponsor_line, channel.sponsor_logo]);

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
          <div className="air-pos" role="radiogroup" aria-label="Where the scorebug sits">
            {BUG_AT.map(([p, label]) => (
              <button key={p} type="button" role="radio" aria-checked={lay.bug.pos === p} aria-label={label} className={lay.bug.pos === p ? 'on' : undefined} onClick={() => moveLay({ ...lay, bug: { ...lay.bug, pos: p } })} />
            ))}
            <small>{BUG_AT.find(([p]) => p === lay.bug.pos)![1]}</small>
          </div>
        </div>
      </section>

      <section className="card pad">
        <h2>Layout and theme</h2>
        <p className="hint">{look === 'pressbox' ? 'Scoreboard’s own bug, laid out and painted any of v4’s ways.' : 'For the Scoreboard look. The animated looks bring their own design.'}</p>
        <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="field"><span>Layout</span>
            <select className="select" value={bc.style ?? 'bar'} onChange={(e) => setB({ style: e.target.value === 'bar' ? null : e.target.value })}>
              {STYLES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="field"><span>Theme</span>
            <select className="select" value={bc.theme ?? 'nightgame'} onChange={(e) => setB({ theme: e.target.value === 'nightgame' ? null : e.target.value })}>
              {THEMES.map(([group, list]) => <optgroup key={group} label={group}>{list.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</optgroup>)}
            </select>
          </label>
        </div>
        {bc.theme === 'custom' && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="field-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
              {([['panel1', 'Panel', '#1d2638'], ['panel2', 'Panel fade', '#0b111c'], ['well', 'Score box', '#070b13'], ['text', 'Text', '#ffffff'], ['accent', 'Accent', '#ffcf3a']] as const).map(([k, label, d]) => (
                <label key={k} className="field"><span>{label}</span>
                  <input className="input" type="color" value={typeof custom[k] === 'string' ? (custom[k] as string) : d} onChange={(e) => setCustom(k, e.target.value)} />
                </label>
              ))}
            </div>
            <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label className="field"><span>Type</span>
                <select className="select" value={String(custom.font ?? 'condensed')} onChange={(e) => setCustom('font', e.target.value)}>
                  <option value="condensed">Condensed</option><option value="clean">Clean</option><option value="mono">Mono</option><option value="serif">Serif</option>
                </select>
              </label>
              <label className="field"><span>Corners</span>
                <select className="select" value={String(custom.radius ?? '10')} onChange={(e) => setCustom('radius', Number(e.target.value))}>
                  <option value="0">Square</option><option value="6">Soft</option><option value="10">Round</option><option value="18">Pill</option>
                </select>
              </label>
            </div>
            <label className="switch"><span className="switch-text"><b>Team colours behind the scores</b></span>
              <input type="checkbox" checked={!!custom.teamFill} onChange={(e) => setCustom('teamFill', e.target.checked)} />
            </label>
          </div>
        )}
      </section>

      <section className="card pad">
        <h2>On the scorebug</h2>
        <div className="air-autos">
          {SHOWS.map(([k, label, sub, def]) => (
            <label key={k} className="switch"><span className="switch-text"><b>{label}</b><small>{sub}</small></span>
              <input type="checkbox" checked={show[k] ?? def} onChange={(e) => setB({ show: { ...show, [k]: e.target.checked } })} />
            </label>
          ))}
        </div>
      </section>

      <section className="card pad">
        <h2>Stat cards</h2>
        <p className="hint">A card slides out from behind the scorebug, on whichever side has room. Pick one above to see it; they are raised and cleared from On Air in the pad.</p>
        <div className="air-autos air-qr">
          <label className="air-slide" style={{ borderTop: 0 }}><span>Size<b>{pct(lay.cards.scale)}</b></span>
            <input type="range" min={CARD_SCALE.min} max={CARD_SCALE.max} step={0.05} value={lay.cards.scale} onChange={(e) => moveLay({ ...lay, cards: { scale: Number(e.target.value) } })} />
          </label>
        </div>
      </section>

      <section className="card pad">
        <h2>Sound</h2>
        <p className="hint">The stream plays a sound for runs, home runs, strikeouts and the other moments. OBS picks it up from the Browser Source: tick &ldquo;Control audio via OBS&rdquo; on the source to mix it.</p>
        <label className="field"><span>Sound pack</span>
          <select className="select" value={sound.pack ?? 'bigleague'} onChange={(e) => setSound({ pack: e.target.value })}>
            {PACKS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <div className="air-autos air-qr">
          <label className="air-slide" style={{ borderTop: 0 }}><span>Volume<b>{pct(sound.master ?? 0.8)}</b></span>
            <input type="range" min={0} max={1} step={0.05} value={sound.master ?? 0.8} onChange={(e) => setSound({ master: Number(e.target.value) })} />
          </label>
          <label className="switch">
            <span className="switch-text"><b>Mute</b><small>Moments still play, silently</small></span>
            <input type="checkbox" checked={!!sound.muted} onChange={(e) => setSound({ muted: e.target.checked })} />
          </label>
        </div>
        <div className="pgrid two">
          <button type="button" className="btn btn-quiet" onClick={() => void send('run')}>Test sound on the stream</button>
          <button type="button" className="btn btn-quiet" disabled={running} onClick={() => void runThrough()}>{running ? 'Playing every moment…' : 'Play every moment on the stream'}</button>
        </div>
      </section>

      <section className="card pad">
        <h2>Scenes</h2>
        <p className="hint">Starting Soon, Final and Game paused cover the whole picture; they are put up and taken down from On Air in the pad. Pick their style here.</p>
        <div className="pills" role="radiogroup" aria-label="Scene style">
          {([['standard', 'Standard'], ['elevated', 'Elevated · network TV']] as const).map(([k, label]) => (
            <label key={k} className="pill wide"><input type="radio" name="scene_style" checked={(bc.scene_style ?? 'standard') === k} onChange={() => setB({ scene_style: k === 'standard' ? null : k })} /><span>{label}</span></label>
          ))}
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

      <section className="card pad">
        <h2>Sponsors in rotation</h2>
        <p className="hint">A corner bug, &ldquo;Brought to you by&rdquo;, that comes up for eight seconds every few minutes, one sponsor after the next. One per line: the name, then a logo link if you have one.</p>
        <label className="field"><span>Sponsors</span>
          <textarea className="textarea" defaultValue={(bc.sponsors?.items ?? []).map((x) => [x.name, x.logo].filter(Boolean).join(' | ')).join('\n')} placeholder={'Dairy Barn | https://example.com/logo.png\nSmith Hardware'}
            onBlur={(e) => setB({ sponsors: { ...(bc.sponsors ?? {}), items: e.target.value.split('\n').map((l) => l.split('|').map((x) => x.trim())).filter(([n]) => n)
              .slice(0, 20).map(([name, logo]) => ({ name: name.slice(0, 40), logo: logo && /^https:\/\//.test(logo) ? logo : null })) } })} style={{ minHeight: 90 }} />
        </label>
        <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="field"><span>Every</span>
            <select className="select" value={String(bc.sponsors?.every ?? 180)} onChange={(e) => setB({ sponsors: { ...(bc.sponsors ?? {}), every: Number(e.target.value) } })}>
              <option value="60">1 minute</option><option value="120">2 minutes</option><option value="180">3 minutes</option><option value="300">5 minutes</option><option value="600">10 minutes</option>
            </select>
          </label>
          <label className="switch"><span className="switch-text"><b>Rotate on the stream</b></span>
            <input type="checkbox" checked={!!bc.sponsors?.on} onChange={(e) => setB({ sponsors: { ...(bc.sponsors ?? {}), on: e.target.checked } })} />
          </label>
        </div>
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
