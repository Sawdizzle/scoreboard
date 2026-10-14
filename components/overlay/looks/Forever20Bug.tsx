'use client';
/* eslint-disable @next/next/no-img-element -- the memorial ribbon, a small fixed file from /public */
import './forever20.css';
import { useEffect, useRef, useState } from 'react';
import type { Brand } from '@/components/TeamBrand';
import { FullFrame, hash, useShow } from '@/components/overlay/looks/BlueSteelBug';
import { homerText, tabName, type BugProps } from '@/components/overlay/looks/types';

// Forever 20, drawn here: Scoreboard's memorial bug (public/bugs/forever20.html),
// in memory of Julian, #20, Sanger TX, rebuilt as part of the page so the stat
// cards can sit behind it. The look is that page's: the ribbon pinned to the
// leading edge, the purple rail with its gold edge, varsity numerals, and the
// strip that carries the at-bat and, every few minutes, his line. The arrow
// is kept too: it crosses the rail with every run, and on a home run it flies
// ahead of a swallowtail banner. A strikeout is a ribbon tail out of the side.
//
// As in ClassicBug, the motion is CSS started by a `key`: a new value mounts
// a new element and its animation plays once. The original's full-frame
// tribute is kept, asked for from the pad (intro kind 'tribute'): the ribbon
// rises in the middle of the frame with his name beside it and gold light
// drifting up, then folds down into the pin and the bug builds out of it. The
// plain intro (kind 'intro') is the original's other one: the bug builds out
// of its pin again.
const RIBBON = '/bugs/img/forever20-ribbon.webp';

// What the strip says for a play: a tag, its colour, and a few words.
function say(text: string, who: string): { tag: string; cls: string; txt: string; back?: boolean } {
  switch (text) {
    case 'Home run': return { tag: 'HR', cls: 'gold', txt: who || 'Home run' };
    case 'Strikeout': return { tag: 'K', cls: 'red', txt: who ? `${who} strikes out` : 'Strikeout swinging' };
    case 'Strikeout looking': return { tag: 'K', cls: 'red', back: true, txt: who ? `${who} caught looking` : 'Called strike three' };
    case 'Single': case 'Double': case 'Triple': return { tag: text, cls: 'gold', txt: who || 'Base hit' };
    case 'Walk': return { tag: 'Walk', cls: 'green', txt: who ? `${who} takes first` : 'Ball four' };
    case 'Hit by pitch': return { tag: 'HBP', cls: 'green', txt: who ? `${who} takes first` : 'Hit by pitch' };
    case 'Double play': return { tag: 'DP', cls: 'red', txt: who || 'Double play' };
    case 'Stolen base': return { tag: 'SB', cls: 'green', txt: who || 'Stolen base' };
    case 'Sac fly': return { tag: 'Sac fly', cls: 'gold', txt: who || 'Sacrifice fly' };
    default: return { tag: text, cls: '', txt: who };
  }
}

// The banner's sparks: sixteen fixed throws (the original rolled them at random on load).
const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SPARKS = Array.from({ length: 16 }, (_, i) => {
  const a = rnd(i + 50) * Math.PI * 2, r = 5 + rnd(i + 100) * 9;
  return {
    '--x': `${(9 + rnd(i) * 64).toFixed(1)}rem`, '--dx': `${(Math.cos(a) * r).toFixed(1)}rem`,
    '--dy': `${(Math.sin(a) * r * 0.8).toFixed(1)}rem`, '--d': `${(0.55 + rnd(i + 150) * 0.5).toFixed(2)}s`,
  } as React.CSSProperties;
});

// The tribute's gold light, drifting up (the original rolled these at random on load).
const MOTES = Array.from({ length: 30 }, (_, i) => {
  const r = (k: number) => hash(700 + i * 17 + k), t = 7 + r(3) * 6;
  return { '--x': `${(r(1) * 100).toFixed(1)}%`, '--s': `${(0.27 + r(2) * 0.47).toFixed(2)}rem`, '--t': `${t.toFixed(1)}s`, '--d': `${(-r(4) * t).toFixed(1)}s`,
    '--dx': `${((r(5) - 0.5) * 10.67).toFixed(2)}rem`, '--o': (0.35 + r(6) * 0.5).toFixed(2) } as React.CSSProperties;
});

function Tribute({ n, pin, onLand }: { n: number; pin: React.RefObject<HTMLDivElement | null>; onLand: (n: number) => void }) {
  const rib = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // At 7.9 s the big ribbon folds down onto the pin; at 9 s the bug builds out of it.
    let anim: Animation | null = null;
    const fold = window.setTimeout(() => {
      const big = rib.current, to = pin.current;
      if (!big || !to) return;
      const a = big.getBoundingClientRect(), b = to.getBoundingClientRect();
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      anim = big.animate([{ transform: 'none' }, { transform: `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px,${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${b.height / Math.max(1, a.height)})` }],
        { duration: still ? 1 : 1100, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
    }, 7900);
    const land = window.setTimeout(() => onLand(n), 9000);
    return () => { window.clearTimeout(fold); window.clearTimeout(land); anim?.cancel(); };
  }, [n, pin, onLand]);
  return (
    <div className="hero">
      <i className="veil" />
      <div className="motes">{MOTES.map((m, i) => <i key={i} style={m} />)}</div>
      <div className="wrap">
        <div ref={rib} className="hrib"><i className="halo" /><img src={RIBBON} alt="" /><i className="shine" /></div>
        <div className="text">
          <small>Tonight we play for</small>
          <div className="nm"><b>Julian</b></div>
          <i className="rule" />
          <div className="num"><span>#20</span><em>Sanger, TX</em></div>
        </div>
      </div>
    </div>
  );
}
// How long a stamp is held: the build-in keys the bug on the last one asked for, for good.
const HOLD = 2147483647;

// The ribbon's arrow: a gold trail, the shaft, a feather and the point.
function Arrow({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 230 30" aria-hidden="true">
      <rect x="0" y="13" width="120" height="4" rx="2" fill="url(#lkf20-trail)" />
      <rect x="92" y="13" width="112" height="4" rx="1.5" fill="url(#lkf20-metal)" stroke="#3a1d10" strokeWidth=".8" />
      <path d="M96 15 L78 4 L112 12 Z M96 15 L78 26 L112 18 Z" fill="#f4e7c4" stroke="#8f6d25" strokeWidth="1" />
      <rect x="112" y="11.5" width="3" height="7" fill="#472a68" /><rect x="117" y="11.5" width="3" height="7" fill="#472a68" />
      <path d="M200 6 L229 15 L200 24 L205 15 Z" fill="url(#lkf20-metal)" stroke="#3a1d10" strokeWidth="1" />
    </svg>
  );
}

function Side({ brand, abbr, score, bat }: { brand: Brand; abbr: string; score: number; bat: boolean }) {
  return (
    <div className={`team${bat ? ' bat' : ''}`} style={{ '--tc': brand.color } as React.CSSProperties}>
      <div className="slab"><span className="ab">{tabName(brand, abbr)}</span></div>
      {/* A new score mounts a new well: it flashes gold and the numeral rolls in. */}
      <div key={score} className="score"><span className="roll"><b>{score}</b></span></div>
    </div>
  );
}

export function Forever20Bug({ g, air, away, home, abbrs, status, period, showLine, moment, intro }: BugProps) {
  // The tribute: the bug waits hidden while it plays, then builds out of the ribbon that folds into its pin.
  const tribute = useShow(intro?.kind === 'tribute' ? intro.n : null, 9900);
  const [landed, setLanded] = useState<number | null>(null);
  const pin = useRef<HTMLDivElement>(null);
  const hiding = tribute !== null && landed !== tribute;
  // The plain intro: the bug builds out of its pin again (a new key mounts it afresh).
  const built = useShow(intro && intro.kind !== 'tribute' ? intro.n : null, HOLD);
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = Math.min(g.balls | 0, 3), strikes = Math.min(g.strikes | 0, 2), outs = g.outs | 0;
  const inning = Number(g.inning) || 1;
  const half = `${g.inning}${g.half}`;
  const runs = (g.away_score | 0) + (g.home_score | 0);
  const base = (on: boolean | undefined, x: number, y: number, cx: number, cy: number, k: string) => (
    <g key={`${k}${on ? 1 : 0}`} className={on ? 'b on pop' : 'b'}><rect x={x} y={y} width="17" height="17" transform={`rotate(45 ${cx} ${cy})`} /></g>
  );
  const k = moment?.text.startsWith('Strikeout') ? moment : null;
  const looking = !!k && k.text.endsWith('looking');
  const hr = moment?.text === 'Home run' ? moment : null;
  const tag = moment ? say(moment.text, moment.who) : null;
  const bat = air.batter, pit = air.pitcher;
  const batBrand = top ? away : home, batAbbr = tabName(batBrand, top ? abbrs.away : abbrs.home);
  // The half that just ended, for the inning's flip: "MID 3" going to the bottom, "END 3" going to the next top.
  const ended = !top ? { word: 'Mid', n: inning } : inning > 1 ? { word: 'End', n: inning - 1 } : { word: 'Top', n: 1 };

  return (
    <div className={`lk-f20${hiding ? ' await' : landed !== null ? ' landed' : ''}`}>
      {tribute !== null && <FullFrame key={tribute} className="lkf20-ff" watch><Tribute n={tribute} pin={pin} onLand={setLanded} /></FullFrame>}
      <svg className="defs" aria-hidden="true">
        <defs>
          <linearGradient id="lkf20-trail" x1="0" x2="1"><stop offset="0" stopColor="#f2d27a" stopOpacity="0" /><stop offset="1" stopColor="#f2d27a" stopOpacity=".85" /></linearGradient>
          <linearGradient id="lkf20-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff0c2" /><stop offset=".5" stopColor="#e2bd62" /><stop offset="1" stopColor="#8f6d25" /></linearGradient>
        </defs>
      </svg>
      <div key={built ?? 'pkg'} className="pkg">
        <div ref={pin} className="medal">
          <span className="mg"><img className={hr ? 'glow' : undefined} src={RIBBON} alt="" /></span>
          <i className="shine" />
        </div>
        <div className="main">
          <div className="rail">
            <Side brand={away} abbr={abbrs.away} score={g.away_score | 0} bat={ball && live && top} />
            <Side brand={home} abbr={abbrs.home} score={g.home_score | 0} bat={ball && live && !top} />
            {!live ? <div className="sit word">{status === 'final' ? 'Final' : 'Pregame'}</div>
              : !ball ? <div className="sit word">{period}</div> : (
                <div className="sit">
                  <div key={half} className="inn">
                    <div className="face"><i className={top ? 'arr up on' : 'arr up'} /><span className="n">{g.inning}</span><i className={top ? 'arr dn' : 'arr dn on'} /></div>
                    <div className="mid"><small>{ended.word}</small><b>{ended.n}</b></div>
                  </div>
                  <svg className="dia" viewBox="0 0 62 52" aria-hidden="true">
                    {base(bases.second, 22, 3, 30.5, 11.5, 's')}{base(bases.third, 5, 22, 13.5, 30.5, 't')}{base(bases.first, 39, 22, 47.5, 30.5, 'f')}
                  </svg>
                  <div className="cnt">
                    <div className="bs"><span className="roll"><b key={balls}>{balls}</b></span><span className="dash">-</span><span className="roll"><b key={strikes}>{strikes}</b></span></div>
                    <div className="outs">{[0, 1, 2].map((i) => <i key={`${i}${i < outs ? 1 : 0}`} className={i < outs ? 'on pop' : undefined} />)}</div>
                  </div>
                </div>
              )}
            {/* A gold light crosses the rail on a run or a home run, and the arrow carries the run. */}
            <i key={`${runs}${hr ? 'h' : ''}`} className="sheen" />
            {runs > 0 && <Arrow key={`z${runs}`} className="zip" />}
          </div>
          {ball && live && (
            <div className="strip">
              {tag && moment ? (
                <div key={`t${moment.text}${moment.who}`} className="line in">
                  <span className={`xtag ${tag.cls}`}>{tag.back ? <span className="back">{tag.tag}</span> : tag.tag}</span><span className="txt">{tag.txt}</span>
                </div>
              ) : (
                <div key={bat?.bid ?? `n${half}`} className="line in">
                  {bat ? <><span className="xtag">AB</span><span className="txt">{bat.name}</span></>
                    : <><span className="xtag">{top ? 'Top' : 'Bot'} {g.inning}</span><span className="txt">{outs === 1 ? '1 out' : `${Math.min(outs, 2)} outs`}</span></>}
                  {bat && showLine && bat.avg && <span className="xtag gold">{bat.avg}</span>}
                  {bat && showLine && bat.today && <span className="today">{bat.today}</span>}
                  {pit && <span className="side">P · {pit.last}{pit.pitches ? <b>{pit.pitches}</b> : null}</span>}
                </div>
              )}
              {/* His line. It stays mounted so its clock keeps running; a play in the strip hides it. */}
              <div className={`line mem${moment ? ' hush' : ''}`}>
                <span className="rib" /><span className="txt">In memory of Julian</span><span className="side">#20 · Sanger, TX</span>
              </div>
            </div>
          )}
        </div>
        {k && (
          <div key={`k${k.text}${k.who}`} className={`kflag${looking ? ' looking' : ''}`}>
            <div className="k"><span>K</span></div>
            <div className="kt">
              <b>{looking ? 'Called strike three' : 'Strikes out swinging'}</b>
              <small>{k.who}{k.who && pit ? ' · ' : ''}{pit && <em>{pit.last}</em>}</small>
            </div>
          </div>
        )}
        {hr && (
          <div key={`h${hr.who}`} className="hrw">
            <div className="hr">
              <div className="hrib" />
              <div className="hbody">
                <div className="t1"><span>Home run</span></div>
                <div className="t2"><i style={{ '--tc': batBrand.color } as React.CSSProperties} /><b>{hr.who || batAbbr}</b>{(hr.who || hr.runs > 0) && <span>{homerText(hr.runs) || batAbbr}</span>}</div>
              </div>
              <div className="gleam" />
            </div>
            <div className="sparks">{SPARKS.map((s, i) => <i key={i} style={s} />)}</div>
            <Arrow className="arrow" />
          </div>
        )}
      </div>
    </div>
  );
}
