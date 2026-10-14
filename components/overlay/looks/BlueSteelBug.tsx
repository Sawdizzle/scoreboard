'use client';
/* eslint-disable @next/next/no-img-element -- the club's crest layers, small fixed files from /public */
import './bluesteel.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparks } from '@/components/overlay/Sparks';
import type { Brand } from '@/components/TeamBrand';
import { homerText, tabName, type BugProps } from '@/components/overlay/looks/types';

// Blue Steel, drawn here: Scoreboard's bug for the club (public/bugs/bluesteel.html),
// rebuilt as part of the page so the stat cards can sit behind its plate. The
// look is that page's: the layered skull crest that sways and whose eye
// burns, the bevelled steel plate with chamfered corners, clay bases, and the
// strip under it. The forge is kept too: a run strikes its score white-hot
// and it cools to steel blue, a strikeout is cut out of the side as a flag,
// and a home run is a plate stamped letter by letter.
//
// As in ClassicBug, the motion is CSS started by a `key`: a new value mounts
// a new element and its animation plays once. The sparks are a canvas of their
// own (Sparks.tsx), laid over the whole picture by FullFrame. The full-frame
// intro is the original's too: a forge light scans the crest into being, BLUE
// STEEL is struck letter by letter with sparks off each strike, embers drift
// up, then the crest flies down into the bug and the plate builds out of it.
const IMG = '/bugs/img/bluesteel';
const HIT: Record<string, string> = { Single: 'ice', Double: 'ice', Triple: 'ice', 'Sac fly': 'ice', Walk: '', 'Hit by pitch': '', 'Double play': 'red', 'Stolen base': 'green' };
const tab = tabName;

/* ---------- Full frame, from inside the dock ----------
   A look is drawn inside the scorebug's dock, and the dock has a filter (its
   drop shadow), so `position: fixed` there is fixed to the dock, not to the
   picture; the bug's own zoom shrinks it too. FullFrame measures where it
   landed and puts itself back over the whole picture: placed by left/top in
   the box it is fixed to, sized to the window, and scaled back by the zoom it
   sits under, so rem inside it is the stream grid's rem. It checks again on
   every frame while `watch` (an effect in flight), else every second, and on
   resize. Midnight and Forever 20 use it too. */
// Whether getBoundingClientRect sees CSS zoom (Chrome 128 and later do; an older build, as OBS ships, may not).
let rectZoom: boolean | undefined;
function rectsSeeZoom() {
  if (rectZoom === undefined) {
    const a = document.createElement('div'), b = document.createElement('div');
    a.style.cssText = 'position:absolute;left:-99px;top:0;zoom:2;visibility:hidden';
    b.style.cssText = 'width:10px;height:10px';
    a.appendChild(b); document.body.appendChild(a);
    rectZoom = b.getBoundingClientRect().width > 15;
    a.remove();
  }
  return rectZoom;
}
const zoomOf = (el: Element | null) => { let z = 1; for (let e = el; e; e = e.parentElement) z *= parseFloat(getComputedStyle(e).zoom) || 1; return z; };

export function FullFrame({ className, watch = false, children }: { className: string; watch?: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last: DOMRect | null = null, w = 0, h = 0, raf = 0;
    const fit = () => {
      const s = el.style;
      s.transform = 'none'; s.left = '0px'; s.top = '0px'; s.width = '1000px'; s.height = '1000px';
      const p = el.getBoundingClientRect(), kr = p.width / 1000 || 1;
      const k = rectsSeeZoom() ? kr : kr * zoomOf(el.parentElement);
      w = window.innerWidth; h = window.innerHeight;
      s.left = `${-p.left / kr}px`; s.top = `${-p.top / kr}px`; s.width = `${w}px`; s.height = `${h}px`; s.transform = `scale(${1 / k})`;
      last = el.getBoundingClientRect();
    };
    const check = () => {
      const r = el.getBoundingClientRect();
      if (!last || w !== window.innerWidth || h !== window.innerHeight || Math.abs(r.left - last.left) > 0.5 || Math.abs(r.top - last.top) > 0.5 || Math.abs(r.width - last.width) > 0.5) fit();
    };
    fit();
    const loop = () => { check(); raf = requestAnimationFrame(loop); };
    const tick = watch ? 0 : window.setInterval(check, 1000);
    if (watch) raf = requestAnimationFrame(loop);
    window.addEventListener('resize', fit);
    return () => { cancelAnimationFrame(raf); window.clearInterval(tick); window.removeEventListener('resize', fit); };
  }, [watch]);
  // `lk-hot` while a watched (moving) frame is up: the stage drops the dock's shadow
  // for it, which would otherwise spread over the whole picture.
  return <div ref={ref} className={`${className}${watch ? ' lk-hot' : ''}`} aria-hidden="true">{children}</div>;
}

// A full-frame show asked for by stamp (the pad's intro): the stamp while it
// runs (`ms`), else null. A new stamp plays; the one a look mounts with plays
// only if it is fresh (stamps are epoch ms), so switching looks later does not
// replay an old intro.
export function useShow(n: number | null | undefined, ms: number) {
  const [n0] = useState(n);
  const [on, setOn] = useState<number | null>(null);
  useEffect(() => {
    if (n == null || (n === n0 && !(Math.abs(Date.now() - n) < 20000))) return;
    const a = window.setTimeout(() => setOn(n), 0);
    const b = window.setTimeout(() => setOn((v) => (v === n ? null : v)), ms);
    return () => { window.clearTimeout(a); window.clearTimeout(b); };
  }, [n, n0, ms]);
  return on;
}

// Fixed throws for the CSS sparks and embers (a page that renders the same twice draws the same).
export const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const COLD = ['#ffffff', '#dcf3ff', '#aad8f8', '#7fc0ef'];
const HOT = ['#fffcee', '#ffdca0', '#ffa55f', '#e0794a'];
type V = React.CSSProperties;
// A burst of streaks from one point: thrown along `angle` (degrees, 0 = right, -90 = up) within `spread`,
// `dist` rem out (with drag) while falling `fall` rem, starting `delay` s in.
function burst(seed: number, n: number, { angle = -90, spread = 150, dist = [8, 20], fall = [6, 16], life = [0.4, 0.9], delay = 0, pal = HOT, len = 1.4 }:
  { angle?: number; spread?: number; dist?: number[]; fall?: number[]; life?: number[]; delay?: number; pal?: string[]; len?: number } = {}): V[] {
  return Array.from({ length: n }, (_, i) => {
    const r = (k: number) => hash(seed * 97 + i * 7 + k);
    return { '--a': `${(angle + (r(1) - 0.5) * spread).toFixed(1)}deg`, '--r': `${mix(dist[0], dist[1], r(2)).toFixed(2)}rem`, '--g': `${mix(fall[0], fall[1], r(3)).toFixed(2)}rem`,
      '--t': `${mix(life[0], life[1], r(4)).toFixed(2)}s`, '--d': `${(delay + r(5) * 0.05).toFixed(3)}s`, '--c': pal[Math.floor(r(6) * pal.length)], '--l': `${(len * mix(0.7, 1.3, r(7))).toFixed(2)}rem` } as V;
  });
}
function Burst({ at, sparks }: { at: V; sparks: V[] }) {
  return <span className="spks" style={at}>{sparks.map((s, i) => <span key={i} className="spk" style={s}><i><b /></i></span>)}</span>;
}

// The intro's pieces, thrown once.
const EYE = burst(1, 30, { angle: 180, spread: 110, dist: [4, 16], fall: [1, 4], life: [0.5, 1.2], delay: 1.5, pal: COLD, len: 1 });
const LETTER = Array.from({ length: 9 }, (_, i) => burst(10 + i, 8, { spread: 130, dist: [8, 22], fall: [8, 22], life: [0.4, 1], delay: 2.27 + i * 0.08 }));
const LAND = burst(30, 22, { spread: 360, dist: [3, 10], fall: [1, 4], life: [0.4, 0.9], pal: COLD, len: 0.9 });
const EMBERS = Array.from({ length: 56 }, (_, i) => {
  const r = (k: number) => hash(500 + i * 11 + k);
  return { '--x': `${mix(13.3, 114.7, r(1)).toFixed(1)}rem`, '--s': `${mix(0.2, 0.45, r(2)).toFixed(2)}rem`, '--t': `${mix(2.6, 4.2, r(3)).toFixed(2)}s`,
    '--d': `${(r(4) * 5.5).toFixed(2)}s`, '--w': `${((r(5) - 0.5) * 4).toFixed(2)}rem`, '--rise': `${mix(24, 60, r(6)).toFixed(1)}rem`,
    '--o': (0.5 + r(7) * 0.4).toFixed(2), '--c': r(8) < 0.3 ? '#ffa55f' : '#aad8f8' } as V;
});

function Hero({ n, away, home, crest, onLand }: { n: number; away: string; home: string; crest: React.RefObject<HTMLDivElement | null>; onLand: (n: number) => void }) {
  const logo = useRef<HTMLDivElement>(null);
  const [land, setLand] = useState<V | null>(null);
  useEffect(() => {
    // At 7.8 s the big crest flies down onto the bug's, and at 8.9 s the bug builds out of it.
    let anim: Animation | null = null, at: V | null = null;
    const fold = window.setTimeout(() => {
      const big = logo.current, to = crest.current;
      if (!big || !to) return;
      const a = big.getBoundingClientRect(), b = to.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      anim = big.animate([{ transform: 'none' }, { transform: `translate(${dx}px,${dy}px) scale(${b.height / Math.max(1, a.height)})` }],
        { duration: still ? 1 : 1100, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
      at = { '--x': `${b.left + b.width / 2}px`, '--y': `${b.top + b.height / 2}px` } as V;
    }, 7800);
    const land = window.setTimeout(() => { if (at) setLand(at); onLand(n); }, 8900);
    return () => { window.clearTimeout(fold); window.clearTimeout(land); anim?.cancel(); };
  }, [n, crest, onLand]);
  return (
    <div className="hero">
      <i className="veil" /><i className="halo" />
      <div ref={logo} className="hlogo">
        <div className="lg">
          <img className="u" src={`${IMG}-under.webp`} alt="" /><img className="f" src={`${IMG}-feathers.webp`} alt="" />
          <img className="s" src={`${IMG}-skull.webp`} alt="" /><i className="eye" /><i className="strk" /><i className="sh" />
        </div>
      </div>
      <i className="scan" />
      <Burst at={{ '--x': '59.45rem', '--y': '24.3rem' } as V} sparks={EYE} />
      <div className="word">
        <div className="w1">{[...'Blue Steel'].map((c, i) => {
          if (c === ' ') return <span key={i} className="sp" />;
          const sp = LETTER[i < 4 ? i : i - 1];
          return <span key={i} className="ch" style={{ '--i': i } as V}>{c}{sp && <Burst at={{ '--x': '50%', '--y': '92%' } as V} sparks={sp} />}</span>;
        })}</div>
        <div className="w2">Baseball</div>
        {(away || home) && <div className="w3"><i /><span>{away}</span><em>at</em><span>{home}</span><i /></div>}
      </div>
      <div className="embers">{EMBERS.map((e, i) => <i key={i} style={e} />)}</div>
      {land && <Burst at={land} sparks={LAND} />}
    </div>
  );
}

function Crest({ fire }: { fire: string | number }) {
  // Remounted when a run scores (or a big play lands): the feathers gust and the eye flares, once.
  return (
    <div key={fire} className="lg flare gust shine">
      <img className="u" src={`${IMG}-under.webp`} alt="" /><img className="f" src={`${IMG}-feathers.webp`} alt="" />
      <img className="s" src={`${IMG}-skull.webp`} alt="" /><i className="eye" /><i className="strk" /><i className="sh" />
    </div>
  );
}

function Side({ brand, abbr, score, bat }: { brand: Brand; abbr: string; score: number; bat: boolean }) {
  return (
    <div className={`team${bat ? ' bat' : ''}`} style={{ '--tc': brand.color } as React.CSSProperties}>
      <div className="slab"><span className="ab">{tab(brand, abbr)}</span></div>
      <div key={score} className="score"><span className="roll"><b>{score}</b></span></div>
    </div>
  );
}

export function BlueSteelBug({ g, air, away, home, abbrs, status, period, showLine, moment, topEdge, intro }: BugProps) {
  // The intro: the bug waits hidden while it plays, then builds out of the crest that flies into it.
  const show = useShow(intro?.n, 9800);
  const [landed, setLanded] = useState<number | null>(null);
  const crest = useRef<HTMLDivElement>(null);
  const hiding = show !== null && landed !== show;
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const half = `${g.inning}${g.half}`;
  const runs = (g.away_score | 0) + (g.home_score | 0);
  const dots = (n: number, of: number) => Array.from({ length: of }, (_, i) => <i key={`${i}${i < n ? 1 : 0}`} className={i < n ? 'on pop' : undefined} />);
  const base = (on: boolean | undefined, x: number, y: number, cx: number, cy: number, k: string) => (
    <g key={`${k}${on ? 1 : 0}`} transform={`rotate(45 ${cx} ${cy})`}><rect className={on ? 'b on pop' : 'b'} x={x} y={y} width="13" height="13" /></g>
  );
  const k = moment?.text.startsWith('Strikeout') ? moment : null;
  const hr = moment?.text === 'Home run' ? moment : null;
  const tag = moment && !k && !hr ? moment : null;
  const bat = air.batter, pit = air.pitcher;
  const batBrand = top ? away : home;

  return (
    <div className={`bsx${hiding ? ' await' : landed !== null ? ' landed' : ''}`}>
      <FullFrame className="bsx-ff"><Sparks away={g.away_score | 0} home={g.home_score | 0} moment={moment?.text ?? null} top={topEdge} /></FullFrame>
      {show !== null && (
        <FullFrame key={show} className="bsx-ff hero-ff" watch>
          <Hero n={show} away={abbrs.away || away.display.toUpperCase()} home={abbrs.home || home.display.toUpperCase()} crest={crest} onLand={setLanded} />
        </FullFrame>
      )}
      <div className="pkg">
        <div ref={crest} className="crest"><Crest fire={`${runs}${hr ? 'h' : ''}${landed ?? ''}`} /></div>
        <div className="main">
          <div className="xstack">
            <div className="plate"><div className="rail">
              <i key={`${runs}${half}`} className="spec" />
              <Side brand={away} abbr={abbrs.away} score={g.away_score | 0} bat={ball && live && top} />
              <Side brand={home} abbr={abbrs.home} score={g.home_score | 0} bat={ball && live && !top} />
              {!live ? <div className="sit word">{status === 'final' ? 'Final' : 'Pregame'}</div>
                : !ball ? <div className="sit word">{period}</div> : (
                  <div className="sit">
                    <div className="inn">
                      <i className={top ? 'arr up on' : 'arr up'} /><span className="n">{g.inning}</span><i className={top ? 'arr dn' : 'arr dn on'} />
                      {/* Between halves a steel shutter drops over the inning, then lifts. */}
                      <div key={half} className="shut"><small>{top ? 'Top' : 'Mid'}</small><b>{g.inning}</b></div>
                    </div>
                    <svg className="dia" viewBox="0 0 64 56" aria-hidden="true">
                      <path className="path" d="M32 49 L51 30 L32 11 L13 30 Z" />
                      <path className="plateH" d="M28.5 46.5 h7 v3.2 l-3.5 3 l-3.5 -3 z" />
                      {base(bases.second, 25.5, 4.5, 32, 11, 's')}{base(bases.third, 6.5, 23.5, 13, 30, 't')}{base(bases.first, 44.5, 23.5, 51, 30, 'f')}
                    </svg>
                    <div className="bso">
                      <em>B</em><div className="dots b">{dots(balls, 3)}</div>
                      <em>S</em><div className="dots s">{dots(strikes, 2)}</div>
                      <em>O</em><div className="dots o">{dots(outs, 2)}</div>
                    </div>
                  </div>
                )}
            </div></div>
            {ball && live && (bat || pit || tag) && (
              <div className="strip">
                {tag ? (
                  <div key={`t${tag.text}${tag.who}`} className="line in">
                    <span className={`xtag ${HIT[tag.text] ?? 'hot'}`}>{tag.text}</span><span className="txt">{tag.who}</span>
                  </div>
                ) : (
                  <div key={bat?.bid ?? 'none'} className="line in">
                    {bat && <><span className="xtag">AB</span><span className="txt">{bat.name}</span></>}
                    {bat && showLine && bat.avg && <span className="xtag hot">{bat.avg}</span>}
                    {bat && showLine && bat.today && <span className="side" style={{ marginLeft: 0 }}>{bat.today}</span>}
                    {pit && <span className="side">P · {pit.last}<b>{pit.pitches}</b></span>}
                  </div>
                )}
              </div>
            )}
          </div>
          {k && (
            <div className={`kw play${k.text.endsWith('looking') ? ' looking' : ''}`}>
              <div className="kflag"><div className="kin">
                <div className="k"><span>K</span></div>
                <div className="kt"><b>{k.who || 'Strikeout'}</b><small>{k.text.endsWith('looking') ? 'Caught looking' : 'Struck out swinging'}</small></div>
              </div></div>
              <i className="blade" />
            </div>
          )}
          {hr && (
            <div className="hrw play">
              <div className="hr"><div className="hin">
                <div className="hcrest"><Crest fire="hr" /></div>
                <div className="hbody">
                  <div className="t1">{[...'Home run'].map((c, i) => (c === ' ' ? <span key={i} className="sp" /> : <span key={i} className="ch" style={{ '--i': i } as React.CSSProperties}>{c}</span>))}</div>
                  <div className="t2"><i style={{ '--tc': batBrand.color } as React.CSSProperties} /><b>{hr.who}</b><span>{homerText(hr.runs) || tab(batBrand, top ? abbrs.away : abbrs.home)}</span></div>
                </div>
                <div className="gleam" />
              </div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
