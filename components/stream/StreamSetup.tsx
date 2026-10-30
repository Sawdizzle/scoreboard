'use client';
/* eslint-disable @next/next/no-img-element -- small fixed thumbnails from /public */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { resetStreamLink, saveSponsor, saveStreamBug } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { CopyLink } from '@/components/CopyLink';
import { BugPreview, brandOf } from '@/components/TeamBrand';
import { BreakSettings } from '@/components/stream/BreakSettings';
import { demoFeed } from '@/lib/demo-feed';
import { BUG_SCALE, CARD_SCALE, QR_OPACITY, QR_SIZE, layoutOf, qrLayer, type BugPos, type CardKind, type CardPos, type Feed, type Layout, type Look, type QrLayer, type QrPos } from '@/lib/onair';
import { mergeBroadcast, type Broadcast, type BroadcastPatch, type Scene } from '@/lib/broadcast';
import { browserClient } from '@/lib/supabase/browser';
import type { Team } from '@/lib/types';

export type StreamChannel = {
  look: Look; layout: Feed['layout']; qr: Feed['qr']; show_line: boolean; broadcast?: Broadcast | null;
  bug_text: string | null; bug_url: string | null; sponsor_name: string | null; sponsor_line: string | null; sponsor_logo: string | null;
};

const BUG_AT: [BugPos, string][] = [['tl', 'Top left'], ['tc', 'Top center'], ['tr', 'Top right'], ['ml', 'Middle left'], ['mc', 'Middle'], ['mr', 'Middle right'],
  ['bl', 'Bottom left'], ['bc', 'Bottom center'], ['br', 'Bottom right']];
// Cards on their own start across the picture from the scorebug, where there is room.
const FREE_DEFAULT: Record<BugPos, BugPos> = { tl: 'tr', tc: 'bc', tr: 'tl', ml: 'mr', mc: 'bc', mr: 'ml', bl: 'br', bc: 'tc', br: 'bl' };
const QR_AT: (QrPos | null)[] = ['tl', 'tc', 'tr', 'ml', null, 'mr', 'bl', 'bc', 'br'];
const QR_LABEL: Record<QrPos, string> = { tl: 'Top left', tc: 'Top center', tr: 'Top right', ml: 'Middle left', mr: 'Middle right', bl: 'Bottom left', bc: 'Bottom center', br: 'Bottom right' };
const CARDS: [CardKind | null, string][] = [[null, 'No card'], ['batter', 'Batter'], ['pitcher', 'Pitcher'], ['dueup', 'Due up'], ['leaders', 'Leaders'], ['box', 'Box score'],
  ['lineup', 'Lineup'], ['defense', 'Defense'], ['matchup', 'Matchup'], ['mid', 'Mid-inning'], ['sponsor', 'Sponsor']];
const pct = (v: number) => `${Math.round(v * 100)}%`;
// v4's five sound packs, every sound synthesized (lib/fx/audio.js).
const PACKS: [string, string][] = [['bigleague', 'Big League organ'], ['modern', 'Modern'], ['sandlot', 'Sandlot 8-bit'], ['airhorn', 'Stadium air horns'], ['organ', 'Pipe organ']];
// v4's Design list: five layouts of Scoreboard's own bug, painted by the
// theme, and the animated scorebugs, which bring their own look and play
// their own home run, strikeout and hit moments (components/overlay/looks).
const LAYOUTS: [string, string, string][] = [
  ['scorebox', 'Scorebox', 'Full broadcast'], ['bar', 'Bar', 'Wide strip'], ['bug', 'Bug', 'Stacked'], ['minimal', 'Minimal', 'Slim'], ['lowerthird', 'Lower-third', 'Across the bottom'],
];
const ANIMATED: [Look, string, string][] = [
  ['mlbfox', 'MLBFox', 'National TV'], ['primetime', 'Prime Time', 'Network TV'], ['bluesteel', 'Blue Steel', 'The club, forged'], ['forever20', 'Forever 20', 'In memory of Julian'],
  ['midnight', 'Midnight', 'Under the lights'], ['classic', 'Classic', 'One tight row'], ['classic-green', 'Classic Green', 'Ballpark board'], ['pinball-dmd', 'Backglass', 'Pinball display'],
  ['chalkboard', 'Chalk Talk', 'Dugout chalkboard'], ['comic', 'Ka-Pow', 'Comic book'], ['split-flap', 'Departures', 'Split-flap board'],
  ['receipt', 'Play-by-Play Printer', 'Receipt'], ['pixel-rpg', 'Battle Mode', '16-bit'],
];
// v4's themes, with the colors each paints (components/overlay/themes.css):
// panel, panel fade, score box, text, accent. Midnight is the default.
type Swatch = [string, string, string, string, string];
const THEMES: [string, [string, string, Swatch?][]][] = [
  ['Your own', [['custom', 'Custom'], ['bluesteel', 'Blue Steel', ['#121a29', '#0a0e16', '#06090f', '#f2f0e9', '#e0794a']], ['forever20', 'Forever 20', ['#5a3787', '#281246', '#1a0a2e', '#fbf3dc', '#f4c84a']]]],
  ['Clean', [['nightgame', 'Midnight', ['#1d2638', '#0b111c', '#070b13', '#ffffff', '#ffcf3a']], ['espn', 'Broadcast Minimal', ['#18191c', '#111214', '#000000', '#ffffff', '#e2231a']],
    ['green', 'Ballpark Green', ['#0f3624', '#071c12', '#04130b', '#ffd24a', '#ff8a3c']], ['carbon', 'Carbon', ['#282a2e', '#1c1e21', '#0c0d0e', '#eceef0', '#e2402f']],
    ['royal', 'Royal', ['#0a1030', '#04081c', '#02040f', '#f2f4ff', '#e8c559']], ['gold', 'Gold', ['#14120c', '#0a0906', '#050403', '#f7efd8', '#d4af37']],
    ['ice', 'Ice', ['#eef4fa', '#cedeee', '#dfe9f4', '#12283d', '#e2593a']]]],
  ['Bold', [['neon', 'Neon', ['#0d0a22', '#060412', '#04030c', '#eafffb', '#ff2bd6']], ['volt', 'Volt', ['#0c0e0c', '#050605', '#000000', '#f3ffe9', '#c6ff00']],
    ['blueprint', 'Blueprint', ['#081428', '#050d1c', '#030812', '#eaf6ff', '#4fd6ff']], ['foil', 'Holo Foil', ['#16161e', '#101016', '#0a0a0e', '#f4f6ff', '#ff9ad5']],
    ['jumbotron', 'Jumbotron', ['#08080a', '#050506', '#000000', '#fff6e0', '#ffb400']]]],
  ['Throwback', [['retro', 'Retro 8-bit', ['#0e1016', '#05070c', '#05070c', '#eafff0', '#ff3ca6']], ['chalkboard', 'Sandlot Slate', ['#163a2b', '#122c21', '#0c1f17', '#f6f3e6', '#ffd977']],
    ['americana', 'Americana', ['#101a3a', '#060c20', '#040817', '#fff6e6', '#e0393e']]]],
];
const swatchVars = (w: Swatch) => ({ '--p1': w[0], '--p2': w[1], '--w': w[2], '--c': w[3], '--a': w[4] }) as CSSProperties;
const SHOWS: [keyof NonNullable<Broadcast['show']>, string, string, boolean][] = [
  ['clock', 'Game clock', 'Time limit, quarter or half', true], ['batter', 'Batter', 'The name on the strip', true], ['pitcher', 'Pitcher', 'The name on the strip', true],
  ['pitchcount', 'Pitch count', 'Beside the pitcher', true], ['rhe', 'Hits and errors', 'Beside each score', false], ['runrule', 'Run rule', 'A badge when the lead reaches it', true],
];

// The scenes the preview can show. Mid-inning is the board between halves.
type PrevKey = 'starting' | 'mid' | 'final' | 'lightning' | 'rain';
const SCENE_OF: Record<Exclude<PrevKey, 'mid'>, Scene> = {
  starting: { kind: 'starting' }, final: { kind: 'final' }, lightning: { kind: 'paused', reason: 'lightning' }, rain: { kind: 'paused', reason: 'rain' },
};
const SCENES: [PrevKey | null, string][] = [[null, 'None'], ['starting', 'Starting soon'], ['mid', 'Mid-inning'], ['final', 'Final'], ['lightning', 'Lightning delay'], ['rain', 'Rain delay']];

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
  const [prevKey, setPrevKey] = useState<Exclude<PrevKey, 'mid'> | null>(null);
  const prevScene = prevKey ? SCENE_OF[prevKey] : null;
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
  const style = bc.style ?? 'bar';
  const theme = bc.theme ?? 'nightgame';
  const col = (k: string, d: string) => (typeof custom[k] === 'string' ? (custom[k] as string) : d);
  const customPaint: Swatch = [col('panel1', '#1d2638'), col('panel2', '#0b111c'), col('well', '#070b13'), col('text', '#ffffff'), col('accent', '#ffcf3a')];
  // The layout tiles wear the theme that will paint them.
  const paint = theme === 'custom' ? customPaint : THEMES.flatMap(([, l]) => l).find(([k]) => k === theme)?.[2] ?? THEMES[1][1][0][2]!;
  // A layout is Scoreboard's own bug in that arrangement.
  const pickLayout = (k: string) => { if (look !== 'pressbox') pickLook('pressbox'); setB({ style: k === 'bar' ? null : k }); };
  const pickLook = (l: Look) => { setLook(l); save({ look: l, layout: lay, qr }); };
  const moveLay = (l: Layout) => { setLay(l); save({ look, layout: l, qr }); };
  const moveQr = (q: QrLayer) => { setQr(q); save({ look, layout: lay, qr: q }); };
  // Moving the cards shows one in the preview, so there is something to see move.
  const placeCards = (pos: CardPos) => { moveLay({ ...lay, cards: { ...lay.cards, pos } }); if (!card) setCard('batter'); };

  const link = /^https:\/\/\S+\.\S+/.test(bugUrl.trim()) ? bugUrl.trim() : /^[\w-]+(\.[\w-]+)+/.test(bugUrl.trim()) ? `https://${bugUrl.trim()}` : null;
  const feed = useMemo(() => demoFeed(team, {
    look, layout: lay, show_line: channel.show_line,
    // In the preview the code is always up, so it can be placed; on air it is a switch.
    qr: { ...qr, on: !!link },
    bug: bugText.trim() || link ? { text: bugText.trim() || null, url: link } : null,
    sponsor: channel.sponsor_name ? { name: channel.sponsor_name, line: channel.sponsor_line, logo: channel.sponsor_logo } : null,
    // The preview shows the look, and a scene only when one is picked below; the ticker is for air.
    broadcast: { ...bc, scene: prevScene, ticker: undefined },
  }), [team, look, lay, qr, bugText, link, bc, prevScene, channel.show_line, channel.sponsor_name, channel.sponsor_line, channel.sponsor_logo]);

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
    <div className="page wide stream">
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
        <p className="hint">A layout is painted by the theme below and works for every sport. An animated scorebug brings its own look and plays its own home run, strikeout and hit moments. Try them all at <a href="/bugs" target="_blank" rel="noopener">/bugs</a>.</p>
        <span className="legend">Layouts · painted by your theme</span>
        <div className="looks designs" role="radiogroup" aria-label="Scorebug layout">
          {LAYOUTS.map(([k, name, sub]) => {
            const on = look === 'pressbox' && style === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={on} className={`look${on ? ' on' : ''}`} onClick={() => pickLayout(k)}>
                <span className="look-thumb"><span className={`dz dz-${k}`} style={swatchVars(paint)}><i /><i /><i /></span></span>
                <b>{name}<small>{sub}</small></b>
              </button>
            );
          })}
        </div>
        <span className="legend">Animated · their own look and moments</span>
        <div className="looks designs" role="radiogroup" aria-label="Animated scorebug">
          {ANIMATED.map(([slug, name, sub]) => (
            <button key={slug} type="button" role="radio" aria-checked={look === slug} className={`look${look === slug ? ' on' : ''}`} onClick={() => pickLook(slug)}>
              <span className="look-thumb">{slug === 'classic' ? <BugPreview brand={brandOf(team)} /> : <img src={`/bugs/thumbs/${slug}.png`} alt="" loading="lazy" />}</span>
              <b>{name}<small>{sub}</small></b>
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
        <h2>Theme</h2>
        {look !== 'pressbox' ? (
          <p className="hint">{ANIMATED.find(([k]) => k === look)?.[1] ?? 'This scorebug'} brings its own colors. Pick a layout above to paint it with a theme.</p>
        ) : (
          <>
            {THEMES.map(([group, list]) => (
              <div key={group} className="stack" style={{ gap: 6 }}>
                <span className="legend">{group}</span>
                <div className="themes" role="radiogroup" aria-label={`${group} themes`}>
                  {list.map(([k, name, w]) => (
                    <button key={k} type="button" role="radio" aria-checked={theme === k} className={`theme${theme === k ? ' on' : ''}`} onClick={() => setB({ theme: k === 'nightgame' ? null : k })}>
                      <span className="dz dz-bar" style={swatchVars(w ?? customPaint)}><i /><i /><i /></span>
                      <b>{name}</b>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {theme === 'custom' && (
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
                <label className="switch"><span className="switch-text"><b>Team colors behind the scores</b></span>
                  <input type="checkbox" checked={!!custom.teamFill} onChange={(e) => setCustom('teamFill', e.target.checked)} />
                </label>
              </div>
            )}
          </>
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
        <p className="hint">Cards are raised and cleared from On Air in the pad. They can slide out from behind the scorebug, or stand on their own anywhere on the picture. Pick a card above to see it here.</p>
        <div className="pills" role="radiogroup" aria-label="Where the cards appear">
          {([['bug', 'With the scorebug'], ['free', 'On their own']] as const).map(([k, label]) => {
            const on = (lay.cards.pos === 'bug') === (k === 'bug');
            return (
              <label key={k} className="pill wide"><input type="radio" name="card_pos" checked={on}
                onChange={() => placeCards(k === 'bug' ? 'bug' : FREE_DEFAULT[lay.bug.pos])} /><span>{label}</span></label>
            );
          })}
        </div>
        {lay.cards.pos !== 'bug' && (
          <div className="air-autos air-qr">
            <div className="air-pos" role="radiogroup" aria-label="Where the cards stand">
              {BUG_AT.map(([p, label]) => (
                <button key={p} type="button" role="radio" aria-checked={lay.cards.pos === p} aria-label={p === lay.bug.pos ? `${label}, where the scorebug is` : label}
                  className={lay.cards.pos === p ? 'on' : p === lay.bug.pos ? 'taken' : undefined} disabled={p === lay.bug.pos} onClick={() => placeCards(p)} />
              ))}
              <small>{BUG_AT.find(([p]) => p === lay.cards.pos)?.[1]}</small>
            </div>
          </div>
        )}
        <div className="air-autos air-qr">
          <label className="air-slide" style={{ borderTop: 0 }}><span>Size<b>{pct(lay.cards.scale)}</b></span>
            <input type="range" min={CARD_SCALE.min} max={CARD_SCALE.max} step={0.05} value={lay.cards.scale} onChange={(e) => moveLay({ ...lay, cards: { ...lay.cards, scale: Number(e.target.value) } })} />
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

      <BreakSettings teamId={team.id} streamUrl={streamUrl} bc={bc} setB={setB} />

      <section className="card pad">
        <h2>Scenes</h2>
        <p className="hint">Starting Soon, the mid-inning board, Final and Game paused cover the whole picture; they are put up and taken down from On Air in the pad. Showtime lights them in your colors, with a wipe, a countdown that rolls and confetti for the winner. Standard is the plain set, for a slow streaming computer.</p>
        <div className="pills" role="radiogroup" aria-label="Scene style">
          {([['elevated', 'Showtime'], ['standard', 'Standard']] as const).map(([k, label]) => (
            <label key={k} className="pill wide"><input type="radio" name="scene_style" checked={(bc.scene_style === 'standard' ? 'standard' : 'elevated') === k} onChange={() => setB({ scene_style: k === 'elevated' ? null : k })} /><span>{label}</span></label>
          ))}
        </div>
        <span className="legend">See one in the preview</span>
        <div className="chips" role="radiogroup" aria-label="Scene shown in the preview">
          {SCENES.map(([k, label]) => {
            const on = k === 'mid' ? card === 'mid' : prevKey === k && card !== 'mid';
            return (
              <button key={label} type="button" role="radio" aria-checked={on} className={`chip${on ? ' on' : ''}`}
                onClick={() => { setPrevKey(k === 'mid' ? null : k); setCard(k === 'mid' ? 'mid' : null); box.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }}>{label}</button>
            );
          })}
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
