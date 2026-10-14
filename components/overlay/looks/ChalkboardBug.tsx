import './chalkboard.css';
import type { CSSProperties, ReactNode } from 'react';
import type { Brand } from '@/components/TeamBrand';
import { homerText, tabName, type BugProps } from '@/components/overlay/looks/types';

// Chalk Talk, drawn here: the dugout chalkboard (public/bugs/chalkboard.html)
// rebuilt as part of the page. Dark slate in a worn wooden frame with a chalk
// ledge under it; everything on it is hand-lettered, and every change is
// written back in by hand with the chalk stick riding the line.
//
// As in BlueSteelBug, the motion is CSS started by a `key`: a new value mounts
// a new element, and its animation (an eraser pass, then the chalk writing it
// in) plays once. The hand-drawn strokes are made once, from a seeded random,
// when this file loads, so they look the same on every render.

/* ---------- seeded randomness and the hand-drawn path makers ---------- */
let seed = 7;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const jit = (a: number) => (rnd() * 2 - 1) * a;
const f1 = (n: number) => Math.round(n * 10) / 10;
type Pt = [number, number];
type Stroke = { d: string; c?: string; w?: number; o?: number };

function line(x1: number, y1: number, x2: number, y2: number, j = 2) { // a slightly bowed stroke
  const mx = (x1 + x2) / 2 + jit(j), my = (y1 + y2) / 2 + jit(j);
  return `M${f1(x1 + jit(1))} ${f1(y1 + jit(1))} Q${f1(mx)} ${f1(my)} ${f1(x2 + jit(1.5))} ${f1(y2 + jit(1.5))}`;
}
function smooth(pts: Pt[]) { // catmull-rom through points
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return d;
}
function loop(cx: number, cy: number, rx: number, ry: number, j = 0.05, over = 0.5) { // a circle that overshoots its own start
  const a0 = Math.PI * (0.9 + jit(0.25)), n = 16, pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * (Math.PI * 2 + over), k = 1 + jit(j) + (i / n) * 0.07;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return smooth(pts);
}
const poly = (pts: Pt[]) => 'M' + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join(' L');
function scribble(cx: number, cy: number, r: number, n = 7, tilt = 0.35) { // hatching filling a diamond
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n, w = (1 - Math.abs(t)) * r * 0.92, y = cy + t * r * 0.88;
    pts.push(i % 2 ? [cx + w, y - w * tilt + jit(1)] : [cx - w, y + w * tilt + jit(1)]);
  }
  return poly(pts);
}
function hatch(cx: number, cy: number, r: number, n = 6) { // scribble fill for a round count mark
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n, w = Math.sqrt(Math.max(0, 1 - t * t)) * r * 0.9, y = cy + t * r * 0.82;
    pts.push(i % 2 ? [cx + w, y - 2 + jit(1)] : [cx - w, y + 2 + jit(1)]);
  }
  return poly(pts);
}
const rhombus = (cx: number, cy: number, r: number) =>
  `M${f1(cx + jit(1))} ${f1(cy - r)} L${f1(cx + r)} ${f1(cy + jit(1))} L${f1(cx + jit(1))} ${f1(cy + r)} L${f1(cx - r)} ${f1(cy + jit(1))} L${f1(cx + 2)} ${f1(cy - r + 1)}`;
function tri(cx: number, cy: number, s: number, up: boolean) {
  const d = up ? 1 : -1;
  return `M${f1(cx - s)} ${f1(cy + d * s * 0.7)} L${f1(cx + jit(1))} ${f1(cy - d * s * 0.85)} L${f1(cx + s)} ${f1(cy + d * s * 0.7)} Z`;
}
function swoosh(x1: number, x2: number, y: number, curl = true) { // underline flourish with a little hook
  const pts: Pt[] = [[x1, y + jit(1)], [x1 + (x2 - x1) * 0.35, y + 3 + jit(1)], [x1 + (x2 - x1) * 0.75, y + 1 + jit(1)], [x2, y - 3]];
  if (curl) pts.push([x2 + 8, y - 12], [x2 - 2, y - 14]);
  return smooth(pts);
}
const plate = (x: number, y: number, s: number) => `M${x - s} ${y - 4} L${x + s} ${y - 4} L${x + s} ${y + (s > 10 ? 4 : 2)} L${x} ${y + (s > 10 ? 13 : 8)} L${x - s} ${y + (s > 10 ? 4 : 2)} Z`;

/* ---------- layout (slate coordinates, 720 x 214), as the original ---------- */
const ROW = { away: 36, home: 96 }, RH = 58;
const COL = { r: 390, h: 452, e: 514 }, CW = 60;
const DIA = { x: 648, y: 112, gap: 32, r: 11 };
const BASE_XY: Pt[] = [[DIA.x + DIA.gap, DIA.y], [DIA.x, DIA.y - DIA.gap], [DIA.x - DIA.gap, DIA.y]]; // first, second, third
const HOME_XY: Pt = [DIA.x, DIA.y + DIA.gap];
const CNT_Y = 187;
const BALL_X = [46, 74, 102], STRK_X = [152, 180], OUT_X = [234, 262];

const RULES: Stroke[] = [{ d: line(12, 157, 708, 159, 3), c: 'thin' }, { d: line(388, 34, 576, 35, 1.5), c: 'thin' }];
const RULE_R: Stroke[] = [{ d: line(586, 10, 584, 152, 2), c: 'thin' }];
const RULE_AB: Stroke[] = [{ d: line(287, 168, 289, 206, 1.5), c: 'thin' }];
const DIAMOND: Stroke[] = [
  { d: `M${HOME_XY[0]} ${HOME_XY[1]} L${BASE_XY[0][0]} ${BASE_XY[0][1]} L${BASE_XY[1][0]} ${BASE_XY[1][1]} L${BASE_XY[2][0]} ${BASE_XY[2][1]} Z`, c: 'thin', o: 0.35 },
  { d: plate(HOME_XY[0], HOME_XY[1], 7) },
  ...BASE_XY.map(([x, y]) => ({ d: rhombus(x, y, DIA.r) })),
];
const COUNT_GHOST: Stroke[] = [
  ...BALL_X.concat(STRK_X).map((x) => ({ d: loop(x, CNT_Y, 10, 10, 0.04, 0.3), c: 'ghostmark' })),
  ...OUT_X.map((x) => ({ d: line(x - 8, CNT_Y, x + 8, CNT_Y, 1), c: 'ghostmark' })),
];
const BALLS: Stroke[][] = BALL_X.map((x) => [{ d: loop(x, CNT_Y, 10, 10) }, { d: hatch(x, CNT_Y, 9, 5), w: 2.6 }]);
const STRIKES: Stroke[][] = STRK_X.map((x) => [{ d: loop(x, CNT_Y, 10, 10), c: 'y' }, { d: hatch(x, CNT_Y, 9, 5), c: 'y', w: 2.6 }]);
const OUTS: Stroke[][] = OUT_X.map((x) => [
  { d: line(x - 9, CNT_Y - 10, x + 9, CNT_Y + 9, 1.5), c: 'p', w: 4.2 }, { d: line(x + 9, CNT_Y - 10, x - 9, CNT_Y + 10, 1.5), c: 'p', w: 4.2 },
]);
const BASES: Stroke[][] = BASE_XY.map(([x, y]) => [{ d: scribble(x, y, DIA.r - 1, 7), c: 'y', w: 3 }, { d: rhombus(x, y, DIA.r + 1), c: 'y', w: 3.8 }]);
const arrow = (y: number): Stroke[] => [{ d: line(10, y, 33, y + 1, 1), c: 'y' }, { d: `M26 ${y - 7} L35 ${y + 1} L25 ${y + 8}`, c: 'y' }];
const ARROW = { away: arrow(ROW.away + RH / 2), home: arrow(ROW.home + RH / 2) };
function halfMark(up: boolean): Stroke[] {
  const cx = 616, cy = up ? 35 : 33, pts: Pt[] = [];
  for (let i = 0; i <= 4; i++) { const t = i / 4, yy = cy + (up ? -8 + t * 14 : 8 - t * 14), w = t * 8; pts.push(i % 2 ? [cx + w, yy] : [cx - w, yy]); }
  return [{ d: tri(cx, cy, 11, up), c: 'y' }, { d: poly(pts), c: 'y', w: 3 }];
}
const HALF = { top: halfMark(true), bottom: halfMark(false) };
// The batter's route round the little diamond, scorebook style.
const ROUTE = [1, 2, 3].map((k) => 'M' + [HOME_XY, ...BASE_XY.slice(0, k)].map(([x, y]) => `${f1(x + jit(1.5))} ${f1(y + jit(1.5))}`).join(' L'));
const FLOURISH = { away: swoosh(COL.r + 6, COL.r + 52, ROW.away + RH - 5), home: swoosh(COL.r + 6, COL.r + 52, ROW.home + RH - 5) };

// The home run board (1100 x 520): ground, plate, an outfield fence, the ball's arc.
const HR_ARC = 'M110 462 Q560 -300 1150 380';
const HR_SCENE: Stroke[] = [
  { d: line(40, 478, 330, 477, 2), c: 'thin' }, { d: line(850, 476, 1085, 474, 2), c: 'thin' },
  { d: plate(110, 468, 14) }, { d: line(915, 404, 1090, 398, 2) },
  ...[925, 947, 969, 991, 1013, 1035, 1057, 1079].map((x) => ({ d: line(x, 402, x - 2, 474, 1.5), c: 'thin' })),
];
const HR_RING: Stroke = { d: loop(482, 240, 436, 116, 0.03, 0.35), c: 'y', w: 6 };
const HR_U1: Stroke = { d: swoosh(120, 850, 352), c: 'y', w: 6 }, HR_U2: Stroke = { d: swoosh(160, 820, 368, false), c: 'y', w: 5 };
// The K board (340 x 380): three fat strokes, each gone over three times.
const K_STROKES: Stroke[][] = ([[118, 42, 116, 250], [128, 168, 236, 44], [156, 140, 242, 254]] as const).map(([x1, y1, x2, y2]) => [
  { d: line(x1, y1, x2, y2, 3), c: 'fat', w: 15 }, { d: line(x1 - 5, y1 + 2, x2 - 5, y2, 2), c: 'fat2' }, { d: line(x1 + 5, y1, x2 + 5, y2 - 2, 2), c: 'fat2' },
]);
const K_END: Pt[] = [[116, 250], [236, 44], [242, 254]];
const K_AT = [[340, 240], [600, 200], [820, 240]];
const K_RING: Stroke = { d: loop(174, 150, 132, 124, 0.03, 0.4), c: 'y', w: 6 };

// The ghost of an old lineup that never quite got erased.
const GHOST: [string, number, number, number, number][] = [
  ['LINEUP', 150, 18, 48, -3], ['1. SS  2. CF', 40, 120, 30, 2], ['bunt → 3B', 430, 150, 34, -4], ['hit the cutoff!', 250, 60, 26, 3], ['P', 600, 40, 60, 0],
];
// What gets chalked next to the batter for a play, and how far round the diamond his route is drawn.
const NOTE: Record<string, { t: string; c: string; route?: number; struck?: boolean }> = {
  Single: { t: '1B', c: 'yel', route: 1 }, Double: { t: '2B', c: 'yel', route: 2 }, Triple: { t: '3B', c: 'yel', route: 3 },
  Walk: { t: 'BB', c: 'blu', route: 1 }, 'Hit by pitch': { t: 'HBP', c: 'blu', route: 1 },
  'Sac fly': { t: 'SF', c: 'yel' }, 'Stolen base': { t: 'SB', c: 'yel' }, 'Double play': { t: 'DP', c: 'pnk', struck: true },
};

const rem = (px: number) => `${px / 10}rem`;
const CHALK: CSSProperties = { filter: 'url(#lkchalk-f)' }, CHALK_BIG: CSSProperties = { filter: 'url(#lkchalk-fbig)' };
const css = (o: Record<string, string | number | undefined>) => o as CSSProperties;

// Chalk strokes, each pulled on like a hand drawing it: `at` ms in, `gap` ms apart.
function Ink({ list, at = 0, dur = 260, gap = 110 }: { list: Stroke[]; at?: number; dur?: number; gap?: number }) {
  return (
    <>
      {list.map((s, i) => (
        <path key={i} d={s.d} pathLength={1} className={`st ${s.c ?? ''}`} style={css({ strokeWidth: s.w, '--o': s.o, '--d': `${at + i * gap}ms`, '--t': `${dur}ms` })} />
      ))}
    </>
  );
}

// One piece of lettering. `rub`: an eraser scrubs the spot first (the old value going), then it is written in.
// `pen`: the chalk stick rides the leading edge. `flow`: it sits in the batter line instead of at x/y.
function Cell({ x = 0, y = 0, w = 0, h = 0, cls, text, at = 0, dur = 300, rub, pen, flow, struck, big }: {
  x?: number; y?: number; w?: number; h?: number; cls: string; text: ReactNode; at?: number; dur?: number;
  rub?: boolean; pen?: boolean; flow?: boolean; struck?: boolean; big?: boolean;
}) {
  const box = flow ? {} : { left: rem(x), top: rem(y), width: rem(w), height: rem(h) };
  return (
    <span className={`c ${cls}${flow ? ' fl' : ''}`} style={css({ ...box, '--e': `${at}ms`, '--d': `${at + (rub ? 230 : 0)}ms`, '--t': `${dur}ms` })}>
      {rub && <><i className="smudge" /><i className="eraser scrub rub" /></>}
      <span className="v"><span className="w">
        <span className={struck ? 't struck' : 't'} style={big ? CHALK_BIG : CHALK}>{text}</span>
        {pen && <i className="tip" />}
      </span></span>
    </span>
  );
}

const Ledge = () => <div className="ledge"><i className="stick s1" /><i className="stick s2" /><i className="eraser felt" /></div>;
const Puff = ({ x, y, s = 1, at = 0 }: { x: number; y: number; s?: number; at?: number }) => (
  <i className="puff" style={css({ left: rem(x), top: rem(y), '--s': s, '--d': `${at}ms` })} />
);

export function ChalkboardBug({ g, air, away, home, abbrs, status, period, showLine, moment }: BugProps) {
  const live = status === 'live', ball = period === null, play = live && ball, top = g.half === 'top';
  const b = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const on = [!!b.first, !!b.second, !!b.third];
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const half = `${g.inning}${g.half}`;
  const k = play && moment?.text.startsWith('Strikeout') ? moment : null;
  const hr = play && moment?.text === 'Home run' ? moment : null;
  const tag = play && moment && !k && !hr ? moment : null;
  const note = tag ? NOTE[tag.text] ?? { t: tag.text, c: 'yel sm' } : null;
  const bat = air.batter, pit = air.pitcher;
  const extras = !!(bat && showLine && (bat.avg || bat.today));
  const looking = !!k?.text.endsWith('looking');
  const batBrand = top ? away : home;

  // A chalk mark that is drawn on when it turns on, and fades under the eraser when it turns off.
  const mark = (key: string, isOn: boolean, list: Stroke[], o: { at?: number; dur?: number; gap?: number; dust?: number } = {}) => (isOn ? (
    <g key={`${key}1`}>
      <Ink list={list} at={o.at} dur={o.dur} gap={o.gap} />
      {o.dust !== undefined && [-5, 3, 7].map((dx, i) => <circle key={i} className="dust" cx={o.dust! + dx} cy={CNT_Y + 10} r={1.4 + i * 0.3} style={css({ '--dx': `${dx * 1.4}px`, '--d': `${260 + i * 60}ms` })} />)}
    </g>
  ) : <g key={`${key}0`} className="gone"><Ink list={list} /></g>);
  // The felt eraser scrubbing a box clear (slate coordinates), when `go` turns true.
  const scrub = (key: string, go: boolean, x: number, y: number, w: number, hgt: number, ms: number, n = 6) => (
    <i key={`${key}${go ? 1 : 0}`} className={go ? 'eraser scrub' : 'none'}
      style={css({ '--x': rem(x - 25.6), '--y': rem(y + hgt / 2 - 13), '--w': rem(w - 12.8), '--a': rem(Math.min(hgt * 0.28, 14)), '--t': `${ms}ms`, '--n': n })} />
  );
  const side = (t: 'away' | 'home', brand: Brand, abbr: string, r: number, h: number, e: number) => (
    <>
      <Cell x={72} y={ROW[t]} w={306} h={RH} cls="h nm left" text={tabName(brand, abbr)} dur={520} pen />
      <Cell key={`r${r}`} x={COL.r} y={ROW[t]} w={CW} h={RH} cls="n big" text={r} dur={260} rub pen />
      {ball && <Cell key={`h${h}`} x={COL.h} y={ROW[t]} w={CW} h={RH} cls="n mid" text={h} dur={240} rub />}
      {ball && <Cell key={`e${e}`} x={COL.e} y={ROW[t]} w={CW} h={RH} cls="n mid" text={e} dur={240} rub />}
    </>
  );
  const flourish = (t: 'away' | 'home', r: number) => r > 0 && (
    <g key={`fl${t}${r}`} className="flo"><Ink list={[{ d: FLOURISH[t], c: 'y', w: 3.4 }]} at={520} dur={300} /></g>
  );

  return (
    <div className="lk-chalk">
      <svg className="defs" width="0" height="0" aria-hidden="true">
        <filter id="lkchalk-f" x="-6%" y="-10%" width="112%" height="120%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="4" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="9" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.4 0 0 0 -0.7" result="mask" />
          <feComposite in="rough" in2="mask" operator="in" />
        </filter>
        <filter id="lkchalk-fbig" x="-4%" y="-6%" width="108%" height="112%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.45" numOctaves="2" seed="2" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="4" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.95 0.5" numOctaves="2" seed="5" result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.6 0 0 0 -0.95" result="mask" />
          <feComposite in="rough" in2="mask" operator="in" />
        </filter>
      </svg>
      <div className="pkg">
        <div className="frame main">
          <div className="slate">
            <div className="ink">
              <svg className="sv" viewBox="0 0 720 214" style={CHALK} aria-hidden="true">
                <Ink list={RULES} gap={30} />
                {ball && <Ink list={RULE_R} />}
                {ball && <Ink list={DIAMOND} gap={30} />}
                {play && <Ink list={RULE_AB} />}
                {play && <Ink list={COUNT_GHOST} gap={30} />}
                {play && (
                  <>
                    {mark('ba', top, ARROW.away, { at: 1100 })}
                    {mark('bh', !top, ARROW.home, { at: 1100 })}
                    <g key={`hf${half}`}><Ink list={HALF[top ? 'top' : 'bottom']} at={1100} /></g>
                    {BASES.map((s, i) => mark(`b${i}`, on[i], s, { at: 180, dur: 320 }))}
                    {BALLS.map((s, i) => mark(`c${i}`, i < balls, s, { dust: BALL_X[i] }))}
                    {STRIKES.map((s, i) => mark(`s${i}`, i < strikes, s, { dust: STRK_X[i] }))}
                    {OUTS.map((s, i) => mark(`o${i}`, i < outs, s, { dur: 200, gap: 170 }))}
                    {flourish('away', g.away_score | 0)}
                    {flourish('home', g.home_score | 0)}
                    {tag && note?.route && (
                      <g key={`rt${tag.text}${tag.who}`} className="fade"><Ink list={[{ d: ROUTE[note.route - 1], c: note.c === 'blu' ? 'b' : 'y', w: 3 }]} at={420} dur={380} /></g>
                    )}
                  </>
                )}
              </svg>
              {side('away', away, abbrs.away, g.away_score | 0, Number(g.away_hits) || 0, Number(g.away_errors) || 0)}
              {side('home', home, abbrs.home, g.home_score | 0, Number(g.home_hits) || 0, Number(g.home_errors) || 0)}
              <Cell x={COL.r} y={6} w={CW} h={28} cls="h lbl" text="R" />
              {ball && <Cell x={COL.h} y={6} w={CW} h={28} cls="h lbl" text="H" />}
              {ball && <Cell x={COL.e} y={6} w={CW} h={28} cls="h lbl" text="E" />}
              {!play ? (
                <Cell key={`w${status}${period ?? ''}`} x={12} y={162} w={696} h={48} cls="h word" text={!live ? (status === 'final' ? 'Final' : 'Pregame') : period} dur={520} rub pen />
              ) : (
                <>
                  <Cell key={`i${g.inning}`} x={634} y={4} w={74} h={58} cls="n big left" text={g.inning} at={1150} dur={260} pen />
                  <Cell x={10} y={166} w={22} h={42} cls="h lbl" text="B" />
                  <Cell x={118} y={166} w={22} h={42} cls="h lbl" text="S" />
                  <Cell x={200} y={166} w={22} h={42} cls="h lbl" text="O" />
                  <div className="line">
                    {(bat || tag) && <Cell cls="h lbl" text="AB" flow />}
                    {tag && note ? (
                      <>
                        <Cell key={`n${tag.text}${tag.who}`} cls="h bn shr" text={tag.who || bat?.name || ''} dur={480} struck={note.struck} flow rub pen />
                        <Cell key={`t${tag.text}${tag.who}`} cls={`n xnote fade ${note.c}`} text={note.t} at={520} dur={300} flow pen />
                      </>
                    ) : bat && (
                      <>
                        <Cell key={bat.bid} cls="h bn shr" text={bat.name} dur={520} flow rub pen />
                        {showLine && bat.avg && <Cell key={`a${bat.bid}`} cls="n avg yel" text={bat.avg} at={620} dur={260} flow />}
                        {showLine && bat.today && <Cell key={`d${bat.bid}${bat.today}`} cls="h today" text={bat.today} at={820} dur={300} flow />}
                      </>
                    )}
                    {pit && <Cell key={`p${pit.pitches}`} cls="n pc" text={`P ${!extras && !tag && pit.last ? `${pit.last} ` : ''}${pit.pitches}`} dur={240} flow rub />}
                  </div>
                </>
              )}
            </div>
            {/* The half turns: the big eraser takes the whole board, and it is written back in behind it. */}
            <div key={`wp${half}`} className="wipe">
              <i className="cover" /><i className="smudge all" />
              <i className="eraser scrub lg" style={css({ '--x': rem(-58.9), '--y': rem(77.1), '--w': rem(690.6), '--a': rem(72), '--t': '950ms', '--n': 11 })} />
            </div>
            <div className="ghost">
              {GHOST.map(([t, x, y, s, r]) => <span key={t} style={{ left: rem(x), top: rem(y), fontSize: rem(s), rotate: `${r}deg` }}>{t}</span>)}
            </div>
            <div className="fx">
              <i className="magnet" style={css({ left: rem(42), top: rem(ROW.away + 12), rotate: '-5deg', '--team': away.color })} />
              <i className="magnet" style={css({ left: rem(42), top: rem(ROW.home + 12), rotate: '4deg', '--team': home.color })} />
              {play && (
                <div className="props">
                  {on.map((isOn, i) => scrub(`eb${i}`, !isOn, BASE_XY[i][0] - 15, BASE_XY[i][1] - 17, 30, 34, 240))}
                  {scrub('ec', balls + strikes === 0, 34, CNT_Y - 16, 162, 32, 320, 8)}
                  {scrub('eo', outs === 0, 222, CNT_Y - 16, 52, 32, 260)}
                  {(g.away_score | 0) > 0 && <Puff key={`pa${g.away_score | 0}`} x={COL.r + 30} y={ROW.away + RH - 25} s={0.6} at={560} />}
                  {(g.home_score | 0) > 0 && <Puff key={`ph${g.home_score | 0}`} x={COL.r + 30} y={ROW.home + RH - 25} s={0.6} at={560} />}
                </div>
              )}
            </div>
          </div>
        </div>
        <Ledge />
        {hr && (
          <div key={`hr${hr.who}`} className="hrw">
            <div className="mboard hrb">
              <div className="frame"><div className="slate">
                <i className="smudge all" />
                <div className="ink">
                  <svg className="sv" viewBox="0 0 1100 520" style={CHALK_BIG} aria-hidden="true">
                    <Ink list={HR_SCENE} at={420} gap={30} />
                    <Ink list={[{ d: HR_ARC, w: 4 }]} at={620} dur={1050} />
                    <circle className="ball" r="10" />
                    <Ink list={[HR_RING]} at={1850} dur={560} />
                    <Ink list={[HR_U1]} at={2350} dur={260} />
                    <Ink list={[HR_U2]} at={2580} dur={230} />
                  </svg>
                  <Cell x={70} y={150} w={820} h={180} cls="n hrw-t" text="HOME RUN!" at={820} dur={950} pen big />
                  <Cell x={70} y={380} w={820} h={72} cls="h hrn" text={hr.who} at={2450} dur={520} pen big />
                  <Cell x={70} y={456} w={820} h={46} cls="h hrs" text={homerText(hr.runs, 'shot').toLowerCase() || tabName(batBrand, top ? abbrs.away : abbrs.home)} at={2950} dur={400} pen big />
                </div>
                <div className="fx">
                  <Puff x={120} y={452} s={0.8} at={620} /><Puff x={1010} y={270} s={1.1} at={1450} />
                  <Puff x={40} y={250} at={1850} /><Puff x={830} y={360} at={2580} />
                  <i className="eraser scrub lg" style={css({ width: rem(192), height: rem(78), '--x': rem(-76.8), '--y': rem(221), '--w': rem(1061.6), '--a': rem(176.8), '--t': '580ms', '--d': '3400ms', '--n': 9 })} />
                </div>
              </div></div>
              <Ledge />
            </div>
          </div>
        )}
        {k && (
          <div key={`k${k.text}${k.who}`} className="kw">
            <div className="mboard kb">
              <div className="frame"><div className="slate">
                <i className="smudge all" />
                <div className="ink">
                  <svg className="sv" viewBox="0 0 340 380" style={CHALK_BIG} aria-hidden="true">
                    <g transform={looking ? 'translate(340,0) scale(-1,1)' : undefined}>
                      {K_STROKES.map((s, i) => <Ink key={i} list={s} at={K_AT[i][0]} dur={K_AT[i][1]} gap={0} />)}
                    </g>
                    <Ink list={[K_RING]} at={1120} dur={480} />
                  </svg>
                  <Cell x={16} y={284} w={308} h={50} cls="h kwho" text={k.who} at={1500} dur={520} pen big />
                  <Cell x={16} y={332} w={308} h={40} cls="h khow" text={looking ? 'caught looking' : 'struck out swinging'} at={1950} dur={520} pen big />
                </div>
                <div className="fx">
                  {K_END.map(([x, y], i) => <Puff key={i} x={looking ? 340 - x : x} y={y} s={0.7} at={K_AT[i][0] + K_AT[i][1]} />)}
                  <i className="eraser scrub lg" style={css({ width: rem(128), height: rem(52), '--x': rem(-51.2), '--y': rem(164), '--w': rem(314.4), '--a': rem(129.2), '--t': '520ms', '--d': '3050ms', '--n': 9 })} />
                </div>
              </div></div>
              <Ledge />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
