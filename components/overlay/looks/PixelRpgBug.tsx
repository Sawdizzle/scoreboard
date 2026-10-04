import './pixel-rpg.css';
import type { CSSProperties, ReactElement } from 'react';
import type { Brand } from '@/components/TeamBrand';
import { tabName, type BugProps } from '@/components/overlay/looks/types';

// Battle Mode, drawn here: Scoreboard's 16-bit bug (public/bugs/pixel-rpg.html),
// rebuilt as part of the page. The at-bat is a turn-based battle: double-line
// pixel windows with banded blue fills, sprites built from pixel maps, outs as
// hearts, the count as pips, and a dialog box that types out each play
// ("SMITH used HOME RUN!" ... "CRITICAL HIT!").
//
// As in BlueSteelBug, the motion is CSS started by a `key`: a new value mounts
// a new element and its animation plays once. The typewriter is per-letter CSS
// delays; the fireworks, frost and the half-inning checker wipe are fixed
// (seeded, not random) patterns of elements with CSS delays.

const INK = '#05061a';
const rem = (px: number) => `${Math.round(px) / 10}rem`;
// A fixed stand-in for Math.random, so the server and the browser draw the same thing.
const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/* ---------- Sprite engine: pixel maps -> crisp inline SVG (as the original's) ---------- */
type Pal = Record<string, string>;
function sprite(rows: string[], pal: Pal, px = 3, cls?: string): ReactElement {
  const src = rows.map((r) => [...r]);
  const h = src.length + 2, w = src[0].length + 2;
  const lit = (y: number, x: number) => { const c = src[y - 1]?.[x - 1]; return !!c && c !== '.' && c !== '#'; };
  // Every lit pixel is wrapped in a one-pixel ink outline.
  const g = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
    const c = src[y - 1]?.[x - 1] ?? '.';
    if (c !== '.') return c;
    return lit(y - 1, x) || lit(y + 1, x) || lit(y, x - 1) || lit(y, x + 1) ? '#' : '.';
  }));
  const P: Pal = { '#': INK, ...pal };
  const rects: ReactElement[] = [];
  g.forEach((r, y) => {
    for (let x = 0; x < r.length;) {
      const c = r[x]; let n = 1;
      while (r[x + n] === c) n++;
      if (c !== '.' && P[c]) rects.push(<rect key={`${x}_${y}`} x={x} y={y} width={n} height={1} fill={P[c]} />);
      x += n;
    }
  });
  return <svg className={cls} style={{ width: rem(w * px), height: rem(h * px) }} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">{rects}</svg>;
}

const TEAM = 'currentColor', HI = 'rgba(255,255,255,.6)', SH = 'rgba(0,0,10,.35)';
const MAP = {
  shield: ['XXXXXXXX', 'XHHXXXXX', 'XHXXXXXD', 'XXXXXXXD', 'XXXXXXXD', '.XXXXXD.', '..XXXD..', '...XD...'],
  heart: ['.RR.RR.', 'RHRRRRR', 'RRRRRRD', '.RRRRD.', '..RRD..', '...D...'],
  base: ['...H...', '..HGG..', '.HGGGG.', 'HGGGGGD', '.GGGGD.', '..GGD..', '...D...'],
  plate: ['WWWWW', 'WWWWW', '.WWW.', '..W..'],
  ball: ['.WWWW.', 'WRWWWS', 'WWRWWS', 'WWWRWS', 'WWWWRS', '.SSSS.'],
  bat: ['......LB', '.....LBB', '....LBB.', '...LBB..', '..LBB...', '.GB.....', 'GG......', 'G.......'],
  cursor: ['W....', 'WW...', 'WWW..', 'WWWW.', 'WWS..', 'WS...', 'S....'],
  up: ['...G...', '..GGG..', '.GGGGG.', 'GGGGGGG'],
  arrowR: ['G....', 'GG...', 'GGG..', 'GGGG.', 'GGG..', 'GG...', 'G....'],
  more: ['GGGGGGG', '.GGGGG.', '..GGG..', '...G...'],
  pip: ['.XXX.', 'XHXXX', 'XXXXX', 'XXXXS', '.XSS.'],
  spark: ['...Y...', '...W...', '..YWY..', 'YWWWWWY', '..YWY..', '...W...', '...Y...'],
  k: ['HRR...RRR', 'HRR..RRR.', 'HRR.RRR..', 'HRRRRR...', 'HRRRR....', 'HRRRRR...', 'HRR.RRR..', 'HRR..RRR.', 'HRR...RRR', 'DDD...DDD'],
  runner: ['..SS.', '..SS.', '.XXX.', 'X.XX.', '..XX.', '.X..X', 'X...X'],
};
const PIP_OFF = { X: '#1f2670', H: '#2a3288', S: '#1a2060' };
const SPR = {
  shield: sprite(MAP.shield, { X: TEAM, H: HI, D: SH }),
  tico: sprite(MAP.shield, { X: TEAM, H: HI, D: SH }, 2),
  heartOn: sprite(MAP.heart, { R: '#ff3b5c', H: '#fff', D: '#b3163a' }, 3, 'on'),
  heartOff: sprite(MAP.heart, { R: '#262a72', H: '#343a8e', D: '#1b1f5a' }, 3, 'off'),
  baseOn: sprite(MAP.base, { G: '#ffd23a', H: '#fff3a8', D: '#c77a00' }, 4),
  baseOff: sprite(MAP.base, { G: '#0d1256', H: '#7f8ae6', D: '#7f8ae6' }, 4),
  plate: sprite(MAP.plate, { W: '#f4f4ff' }, 3, 'hplate'),
  ball: sprite(MAP.ball, { W: '#f4f4ff', R: '#ff3b5c', S: '#b8bde8' }),
  ballBig: sprite(MAP.ball, { W: '#f4f4ff', R: '#ff3b5c', S: '#b8bde8' }, 6, 'lball'),
  bat: sprite(MAP.bat, { L: '#f7d49a', B: '#d0893e', G: '#6a3b1a' }),
  cursor: sprite(MAP.cursor, { W: '#f4f4ff', S: '#b8bde8' }),
  up: sprite(MAP.up, { G: '#ffd23a' }, 3, 'ar'),
  down: sprite([...MAP.up].reverse(), { G: '#ffd23a' }, 3, 'ar'),
  arrowR: sprite(MAP.arrowR, { G: '#ffd23a' }, 3),
  ballPip: [sprite(MAP.pip, PIP_OFF), sprite(MAP.pip, { X: '#5cf07c', H: '#e6ffe9', S: '#1f9a45' })],
  strkPip: [sprite(MAP.pip, PIP_OFF), sprite(MAP.pip, { X: '#ff9a2a', H: '#fff0c0', S: '#b25300' })],
  spark: sprite(MAP.spark, { Y: '#ffd23a', W: '#fff' }, 4),
  sparkS: sprite(MAP.spark, { Y: '#8ee8ff', W: '#fff' }, 3),
  impact: sprite(MAP.spark, { Y: '#ffd23a', W: '#fff' }, 16),
  kRed: sprite(MAP.k, { R: '#ff3b5c', H: '#ff9aaa', D: '#9c1030' }, 12),
  kIce: sprite(MAP.k, { R: '#6fd8ff', H: '#e8fbff', D: '#2479b8' }, 12),
  runner: sprite(MAP.runner, { X: TEAM, S: '#f2c39a' }),
};

/* ---------- Effects, as fixed patterns ---------- */
// Pixel sparkles around a point.
function Sparkles({ x, y, n, spread, small, delay = 0, seed = 0 }: { x: number; y: number; n: number; spread: number; small?: boolean; delay?: number; seed?: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const a = rnd(seed + i * 3) * Math.PI * 2, r = spread * (0.4 + rnd(seed + i * 3 + 1) * 0.6);
        return (
          <i key={i} className="spk" style={{ left: rem(x + Math.cos(a) * r), top: rem(y + Math.sin(a) * r), animationDelay: `${delay + i * 70}ms` }}>
            {small ? SPR.sparkS : SPR.spark}
          </i>
        );
      })}
    </>
  );
}
// Pixel firework: a ring of square particles that burst, drift down and blink out.
function Burst({ x, y, n, rad, colors, delay = 0, seed = 0 }: { x: number; y: number; n: number; rad: number; colors: string[]; delay?: number; seed?: number }) {
  return (
    <i className="fw" style={{ left: rem(x), top: rem(y) }}>
      <i className="spk" style={{ animationDelay: `${delay}ms` }}>{SPR.spark}</i>
      {Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2 + rnd(seed + i) * 0.2, r = rad * (0.75 + rnd(seed + i + 50) * 0.35);
        const dx = Math.round(Math.cos(a) * r / 4) * 4, dy = Math.round(Math.sin(a) * r / 4) * 4;
        return <i key={i} className={i % 3 === 0 ? 'pxl lg' : 'pxl'} style={{ background: colors[i % colors.length], '--x': rem(dx), '--y': rem(dy), animationDelay: `${delay}ms` } as CSSProperties} />;
      })}
    </i>
  );
}
// The half-inning battle transition: checker blocks swirl in from the rim, then dissolve.
const WIPE = Array.from({ length: 11 * 28 }, (_, i) => {
  const r = Math.floor(i / 28), c = i % 28;
  const x = c * 26 + 13 - 364, y = r * 26 + 13 - 135;
  const a = (Math.atan2(y, x) + Math.PI) / (Math.PI * 2), d = Math.hypot(x, y) / Math.hypot(364, 135);
  return { w: (r + c) % 2 === 1, a: Math.round((1 - d) * 260 + a * 190), b: Math.round(640 + rnd(i) * 320) };
});
const FROST = Array.from({ length: 14 }, (_, i) => ({ left: rnd(i + 400) * 170 - 10, top: rnd(i + 500) * 60, fall: 120 + rnd(i + 600) * 80, delay: 300 + i * 90 }));

/* ---------- Dialog box: types line by line ---------- */
type Line = { t: string; cls?: string; flash?: boolean; hold?: number };
const SPEED = 34;
function Dialog({ lines, hold, delay = 0, max }: { lines: Line[]; hold: number; delay?: number; max?: number }) {
  const out: { L: Line; start: number; typed: number; end: number; els: (ReactElement | string)[] }[] = [];
  let at = delay;
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li], start = at, els: (ReactElement | string)[] = [];
    let n = 0;
    for (const part of L.t.split(/(\{>\})/)) {
      if (part === '{>}') { els.push(<span key={`a${n}`} className="c ic" style={{ animationDelay: `${start + n * SPEED}ms` }}>{SPR.arrowR}</span>); n++; continue; }
      for (const ch of part) {
        if (ch === ' ') { els.push(' '); continue; }
        els.push(<span key={`c${n}`} className="c" style={{ animationDelay: `${start + n * SPEED}ms` }}>{ch}</span>); n++;
      }
    }
    const typed = start + n * SPEED;
    at = typed + (L.hold ?? (li === lines.length - 1 ? hold : 650));
    out.push({ L, start, typed, end: at, els });
  }
  const life = max ? Math.min(max, at) : at;
  return (
    <div className="win dlg" style={{ '--d': `${delay}ms`, '--e': `${life}ms` } as CSSProperties}>
      <div className="txt">
        {out.map((o, i) => {
          const more = i < out.length - 1;
          return (
            <div key={i} className={`ln${o.L.cls ? ` ${o.L.cls}` : ''}${more ? ' hide' : ''}`} style={more ? ({ '--h': `${o.end}ms` } as CSSProperties) : undefined}>
              {o.els}
              {more && <i className="more" style={{ '--w': `${o.typed}ms` } as CSSProperties}>{sprite(MAP.more, { G: '#f4f4ff' }, 3)}</i>}
            </div>
          );
        })}
      </div>
      {out.map((o, i) => (o.L.flash ? <i key={`f${i}`} className="fl" style={{ animationDelay: `${o.start}ms` }} /> : null))}
    </div>
  );
}

// A name typed out: a steps() reveal, one letter per step.
function Typed({ text }: { text: string }) {
  const n = Math.max(1, text.length);
  return <b key={text} className="ty" style={{ animationDuration: `${n * 45}ms`, animationTimingFunction: `steps(${n})` }}>{text}</b>;
}

const surname = (n: string | null | undefined) => { const p = String(n || '').trim().split(/\s+/); return (p[p.length - 1] || '').toUpperCase().slice(0, 10); };
const HITS: Record<string, [string, number]> = { Single: ['SINGLE', 1], Double: ['DOUBLE', 2], Triple: ['TRIPLE', 3] };

function Row({ brand, abbr, r, h, e, bat }: { brand: Brand; abbr: string; r: number; h: number; e: number; bat: boolean }) {
  const name = tabName(brand, abbr).toUpperCase();
  return (
    <div className={`xrow${bat ? ' bat' : ''}`}>
      <i className="cur">{SPR.cursor}</i>
      <i className="ico" style={{ color: brand.color }}>{SPR.shield}</i>
      <b className={`ab${name.length > 8 ? ' s' : name.length > 5 ? ' m' : ''}`}>{name}</b>
      <span className="st r"><em>R</em><b key={r} className="v bump">{r}</b>
        {r > 0 && <span key={`s${r}`} className="sps"><Sparkles x={36} y={16} n={3} spread={34} seed={r * 7} /></span>}
      </span>
      <span className="st h"><em>H</em><b key={h} className="v bump">{h}</b></span>
      <span className="st e"><em>E</em><b key={e} className={e > 0 ? 'v err' : 'v'}>{e}</b></span>
    </div>
  );
}

export function PixelRpgBug({ g, air, away, home, abbrs, status, period, showLine, moment }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null, on = live && ball;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = Math.min(3, g.outs | 0);
  const half = `${g.inning}${g.half}`;
  const bat = air.batter, pit = air.pitcher;
  const batBrand = top ? away : home, fldBrand = top ? home : away;
  const batAbbr = tabName(batBrand, top ? abbrs.away : abbrs.home).toUpperCase();

  // The play being called, as the original's battle text.
  const m = on ? moment : null;
  const mk = m ? `${m.text}|${m.who}` : '';
  const who = surname(m?.who || bat?.name || 'Batter'), pitN = surname(pit?.last || 'The pitcher');
  const hr = m?.text === 'Home run', k = !!m?.text.startsWith('Strikeout'), look = m?.text === 'Strikeout looking';
  const hit = m ? HITS[m.text] : undefined;
  const walk = m?.text === 'Walk', hbp = m?.text === 'Hit by pitch', steal = m?.text === 'Stolen base';
  const outPlay = m?.text === 'Double play' || m?.text === 'Sac fly';
  let lines: Line[] = [], hold = 1300;
  if (m) {
    if (hr) { lines = [{ t: `${who} used HOME RUN!`, hold: 520 }, { t: m!.runs >= 4 ? 'GRAND SLAM!' : m!.runs > 1 ? `CRITICAL HIT! +${m!.runs} RUNS` : 'CRITICAL HIT!', cls: 'gold', flash: true }]; hold = 2400; }
    else if (k) lines = [{ t: `${pitN} used STRIKEOUT!`, hold: 700 }, look ? { t: `${who} was frozen!`, cls: 'ice' } : { t: `${who} is out!` }];
    else if (hit) lines = [{ t: `${who} used ${hit[0]}!` }];
    else if (walk) { lines = [{ t: `${pitN}'s control wavers...`, hold: 600 }, { t: `${who} takes 1st.` }]; hold = 1200; }
    else if (hbp) { lines = [{ t: `${who} was hit by the pitch!`, cls: 'red', hold: 600 }, { t: `${who} takes 1st.` }]; hold = 1200; }
    else if (m.text === 'Double play') { lines = [{ t: 'DOUBLE PLAY!', cls: 'red', hold: 700 }, { t: `${who} is out.` }]; hold = 1100; }
    else if (m.text === 'Sac fly') lines = [{ t: `${who} used SAC FLY!` }];
    else if (steal) { lines = [{ t: 'A runner used STEAL!', cls: 'ice' }]; hold = 1400; }
    else lines = [{ t: `${m.text.toUpperCase()}!${m.who ? ` ${who}` : ''}` }];
  }
  const hop = hit ? `hop${hit[1]}` : walk || hbp ? 'hopw' : '';
  const batCls = k ? ' m-k' : outPlay || hbp ? ' m-out' : '';
  const flashBat = hr || k || !!hit;
  const fwCol = ['#ffd23a', '#fff3a8', '#f4f4ff', batBrand.color, '#ff9a2a'];
  const word = !live ? (status === 'final' ? 'Final' : 'Pregame') : !ball ? String(period) : '';
  const turned = on && !(g.inning === 1 && top);   // nothing to announce before the first pitch

  const pips = (n: number, of: number, set: ReactElement[]) => Array.from({ length: of }, (_, i) => (
    <i key={`${i}${i < n ? 1 : 0}`} className={i < n ? 'pip pop' : 'pip'}>{set[i < n ? 1 : 0]}</i>
  ));
  const base = (lit: boolean | undefined, cls: string) => <i key={`${cls}${lit ? 1 : 0}`} className={`base ${cls}${lit ? ' pop' : ''}`}>{lit ? SPR.baseOn : SPR.baseOff}</i>;

  return (
    <div className="lk-rpg">
      <div className="pkg">
        <div className={`cluster${top ? '' : ' bot'}${hr ? ' m-hr' : ''}`}>
          {/* party list: the two teams */}
          <div className="win party">
            <Row brand={away} abbr={abbrs.away} r={g.away_score | 0} h={Number(g.away_hits) || 0} e={Number(g.away_errors) || 0} bat={on && top} />
            <Row brand={home} abbr={abbrs.home} r={g.home_score | 0} h={Number(g.home_hits) || 0} e={Number(g.home_errors) || 0} bat={on && !top} />
            {hr && <i key={mk} className="fl" />}
          </div>

          {/* field: inning, bases, outs as hearts */}
          {!on ? <div className="win xfield word"><b className={word.length > 9 ? 'long' : undefined}>{word}</b></div> : (
            <div className="win xfield">
              <div className={top ? 'inn' : 'inn bot'}>{top ? SPR.up : SPR.down}<b key={g.inning} className="v bump">{g.inning}</b></div>
              <div className="dia">
                {base(bases.second, 'b2')}{base(bases.third, 'b3')}{base(bases.first, 'b1')}{SPR.plate}
                {hop && <i key={mk} className={`runner ${hop}`} style={{ color: batBrand.color }}>{SPR.runner}</i>}
                {steal && <span key={mk}><Sparkles x={56} y={36} n={5} spread={46} seed={90} /></span>}
              </div>
              <div className="hearts">
                {[0, 1, 2].map((i) => {
                  const lost = i >= 3 - outs;
                  return (
                    <i key={`${i}${lost ? 1 : 0}`} className={lost ? 'heart lost' : 'heart'}>
                      {SPR.heartOn}{SPR.heartOff}
                      {lost && <Burst x={13} y={12} n={8} rad={34} colors={['#ff3b5c', '#ffd0d8']} delay={560} seed={i * 20} />}
                    </i>
                  );
                })}
              </div>
              {hr && <i key={mk} className="fl" />}
            </div>
          )}

          {/* the duel */}
          {on && (
            <div className="duo">
              <div className="xslot pits">
                <div className={`win pitw${walk ? ' m-walk' : ''}`}>
                  <div className="nm">{SPR.ball}<Typed text={surname(pit?.last || 'Pitcher')} /></div>
                  <div className="stat" style={pit?.pitches ? undefined : { visibility: 'hidden' }}>
                    <em>PC</em><b className="v">{pit?.pitches ?? 0}</b><i className="tico" style={{ color: fldBrand.color }}>{SPR.tico}</i>
                  </div>
                  {hr && <i key={mk} className="fl" />}
                </div>
              </div>
              <div key={bat?.bid ?? 'none'} className={`xslot bats${hr ? ' top' : ''}`}>
                <div className={`win batw${batCls}`}>
                  <div className="nm">{SPR.bat}<Typed text={surname(bat?.name || 'Batter')} /></div>
                  <div className="stat">
                    <em>B</em><span className="pips">{pips(balls, 3, SPR.ballPip)}</span>
                    <em>S</em><span className="pips">{pips(Math.min(2, strikes), 2, SPR.strkPip)}</span>
                    <i className="tico" style={{ color: batBrand.color }}>{SPR.tico}</i>
                  </div>
                  {bat && showLine && (bat.avg || bat.today) && (
                    <div className="stat line">
                      {bat.avg && <><em>AVG</em><b className="v">{bat.avg}</b></>}
                      {bat.today && <small>{bat.today}</small>}
                    </div>
                  )}
                  {flashBat && <i key={mk} className="fl" />}
                  {k && <span key={`s${mk}`} className="sl">{[22, 46, 70].map((t, i) => <i key={i} className="xslash" style={{ top: `${t}%`, animationDelay: `${i * 80}ms` }} />)}</span>}
                </div>
                {hr && <span key={mk} className="hrb">{SPR.ballBig}<i className="spk big">{SPR.impact}</i></span>}
              </div>
            </div>
          )}

          {/* half-inning battle transition, and whose turn it is */}
          {turned && <div key={`w${half}`} className="wipe">{WIPE.map((b, i) => <i key={i} className={b.w ? 'w' : undefined} style={{ '--a': `${b.a}ms`, '--b': `${b.b}ms` } as CSSProperties} />)}</div>}
          {turned && (
            <Dialog key={`h${half}`} delay={700} hold={1300} lines={[
              { t: `${top ? 'BOTTOM' : 'TOP'} ${top ? Number(g.inning) - 1 : g.inning} {>} ${top ? 'TOP' : 'BOTTOM'} ${g.inning}`, hold: 700 },
              { t: `${batAbbr}'s turn to bat!` },
            ]} />
          )}

          {/* the play: dialog, the big K, home-run fireworks */}
          {m && <Dialog key={`m${mk}`} lines={lines} hold={hold} max={4240} />}
          {k && (
            <div key={`k${mk}`} className="kz">
              <Burst x={75} y={70} n={20} rad={120} colors={look ? ['#8ee8ff', '#fff', '#2479b8'] : ['#ff3b5c', '#fff', '#ffd23a']} delay={140} seed={7} />
              <Sparkles x={75} y={80} n={6} spread={100} small={look} delay={200} seed={31} />
              <div className={look ? 'ksp xlook' : 'ksp'}>
                <div className="spr">{look ? SPR.kIce : SPR.kRed}</div><div className="lbl">{look ? 'LOOKING' : 'SWINGING'}</div>
                {look && FROST.map((f, i) => <i key={i} className="frost" style={{ left: rem(f.left), top: rem(f.top), '--f': rem(f.fall), animationDelay: `${f.delay}ms` } as CSSProperties} />)}
              </div>
            </div>
          )}
          {hr && (
            <div key={`f${mk}`} className="hrfx">
              {[0, 1, 2].map((i) => (
                <span key={i}>
                  <Burst x={190 + i * 170} y={40 + i * 97} n={24} rad={160} colors={fwCol} delay={2300 + i * 170} seed={i * 100} />
                  <Burst x={190 + i * 170} y={40 + i * 97} n={12} rad={70} colors={['#fff', '#ffd23a']} delay={2390 + i * 170} seed={i * 100 + 60} />
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
