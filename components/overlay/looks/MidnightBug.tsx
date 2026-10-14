'use client';
import './midnight.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FullFrame, hash, useShow } from '@/components/overlay/looks/BlueSteelBug';
import { homerText, tabName, type BugProps } from '@/components/overlay/looks/types';

// Midnight, drawn here: Scoreboard's night-game bug (public/bugs/midnight.html),
// rebuilt as part of the page so the stat cards can sit behind its plate. The
// look is that page's: a moon at the edge with a breathing halo, a navy plate
// that is a window on a drifting, twinkling sky, gold bases and count, and the
// strip under it. Its moments are kept too: a run strikes the score with
// starlight, a hit runs a line of light round the little diamond, a strikeout
// is a bank of stadium bulbs that punches a K on and goes dark, a home run is
// the moonshot banner, and between halves a small moon rises in the inning box.
//
// As in ClassicBug, the bug's own motion is CSS started by a `key`: a new value
// mounts a new element and its animation plays once. What flies over the
// picture is the original's one canvas (Sky, below), laid over the whole frame
// by FullFrame and mounted only while something is in the air: a run is a
// meteor that lands in the score, a hit a comet round the little diamond, the
// home run a moonshot whose stardust gathers into the words with fireworks
// beside them, and a walk-off lights the whole sky. Bases loaded (or a walk-off)
// is a rally: an aurora moves through the plate and fireflies drift off it.
// The full-frame intro is the original's: a night sky fills in, the moon rises,
// the stars gather into UNDER THE LIGHTS, the four light banks switch on, then
// the moon sets into the bug and the plate opens out of it.
type V = React.CSSProperties;
const TAG: Record<string, [tag: string, cls: string, fallback: string]> = {
  'Home run': ['HR', 'hot', 'Home run'], Strikeout: ['K', 'red', 'Strikeout swinging'], 'Strikeout looking': ['ꓘ', 'red', 'Called strike three'],
  Single: ['Single', 'ice', 'Base hit'], Double: ['Double', 'ice', 'Base hit'], Triple: ['Triple', 'ice', 'Base hit'],
  Walk: ['Walk', 'green', 'Ball four'], 'Hit by pitch': ['HBP', 'green', 'Hit by pitch'],
  'Double play': ['DP', 'red', 'Double play'], 'Stolen base': ['SB', 'green', 'Stolen base'], 'Sac fly': ['Sac fly', 'ice', 'Sacrifice fly'],
};
// How far round the diamond the line of light runs for a play.
const BASES: Record<string, number> = { Single: 1, Double: 2, Triple: 3, Walk: 1, 'Hit by pitch': 1 };
// A K on a 5 x 7 bank, in the order the bulbs strike: the stem, then both arms out from the middle.
const K_ORDER = [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [1, 3], [2, 2], [2, 4], [3, 1], [3, 5], [4, 0], [4, 6]];
// Twinkling stars: left %, top %, period s, head start s, warm.
const TW: [number, number, number, number, boolean][] = [
  [6, 12, 3.1, 0.4, false], [15, 88, 4.4, 2.1, true], [24, 8, 2.6, 3.3, false], [33, 91, 5, 1.2, false], [41, 18, 3.7, 4.5, true], [50, 84, 2.9, 0.9, false],
  [58, 10, 4.8, 2.8, false], [67, 93, 3.3, 3.9, true], [76, 21, 2.4, 1.7, false], [85, 86, 4.1, 4.8, false], [94, 14, 3.5, 0.2, false],
];
const TW_HR: [number, number, number, number, boolean][] = [
  ...TW, [10, 22, 4.6, 1.5, true], [29, 82, 2.7, 3.1, false], [46, 6, 3.9, 2.4, false], [62, 89, 4.3, 0.7, false], [72, 9, 2.5, 4.1, true], [89, 81, 3.2, 2.9, false], [97, 23, 5.1, 1.1, false],
];
const surname = (n: string) => n.trim().split(/\s+/).pop() ?? '';

/* ---------- The sky: one canvas for everything that flies (the original's, ported) ----------
   P sparks and motes   C comets (a ball, a shooting star)   R flashes and rings
   F firework shells    G star text: stars that fly to the shape of a word, rest there, and blow away
   Positions are in the original's units, a 1920-wide stage, whatever size the source is. */
type Rgb = number[];
type Pt = [number, number];
const GOLD: Rgb[] = [[255, 253, 244], [255, 232, 170], [240, 190, 80], [190, 120, 40], [70, 35, 10]];
const ICE: Rgb[] = [[255, 255, 255], [222, 236, 252], [160, 196, 232], [80, 118, 160], [22, 36, 62]];
const WARM: Rgb[] = [[255, 255, 250], [255, 244, 214], [255, 214, 140], [220, 150, 70], [60, 30, 12]];
const STAR_RGB = ['255,250,236', '255,226,160', '205,225,248'];
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (u: number) => 1 - (1 - u) ** 3;
const easeIO = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const tint = (pal: Rgb[], t: number) => {
  const x = Math.min(pal.length - 1.001, Math.max(0, t) * (pal.length - 1)), i = x | 0, f = x - i, a = pal[i], b = pal[i + 1];
  return `${(a[0] + (b[0] - a[0]) * f) | 0},${(a[1] + (b[1] - a[1]) * f) | 0},${(a[2] + (b[2] - a[2]) * f) | 0}`;
};
const palFrom = (hex: string): Rgb[] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return GOLD;
  const n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255], mix = (k: number) => c.map((v) => Math.round(v + (255 - v) * k));
  return [[255, 255, 255], mix(0.55), mix(0.2), c, c.map((v) => (v * 0.3) | 0)];
};
const quad = (a: Pt, c: Pt, b: Pt) => (u: number): Pt => { const v = 1 - u; return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]]; };
function poly(pts: Pt[]) {
  const segs: [number, number, Pt, Pt][] = [];
  let L = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push([L, l, pts[i - 1], pts[i]]); L += l; }
  return (u: number): Pt => {
    const d = u * L;
    for (const [s0, l, a, b] of segs) if (d <= s0 + l || b === pts[pts.length - 1]) { const f = l ? clamp01((d - s0) / l) : 1; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
    return pts[pts.length - 1];
  };
}
type Spark = { x: number; y: number; vx: number; vy: number; life: number; s: number; age: number; pal: Rgb[] } & (
  { mote: true; sway: number; w: number; ph: number; o: number; glow: HTMLCanvasElement } |
  { mote?: false; g: number; drag: number; tail: number; crackle?: boolean; glint?: HTMLCanvasElement | null });
type Comet = { path: (u: number) => Pt; dur: number; size: number; glow: HTMLCanvasElement; trail: number; ease: (u: number) => number; debris: number; pal: Rgb[];
  onEnd?: (x: number, y: number) => void; age: number; tr: Pt[]; done: boolean };
type Ring = { x: number; y: number; life: number; age: number } & ({ flash: true; r: number; glow: HTMLCanvasElement } | { flash?: false; r0: number; r1: number; rgb: string; w: number });
type Shell = { x: number; y: number; x0: number; y0: number; y1: number; pal: Rgb[]; n: number; kind: string; speed: number; dur: number; age: number; gone?: boolean };
type Star = { x: number; y: number; px: number; py: number; sx: number; sy: number; tx: number; ty: number; dl: number; du: number; cu: number; s: number; ph: number; w: number;
  c: number; glow: boolean; fa: number; fi: number; age: number; mode: 'idle' | 'fly' | 'rest' | 'gone'; vx?: number; vy?: number; sl?: number; dead?: boolean };
type Group = { stars: Star[]; dim: number; dimTo: number; age: number };
type BurstOpts = { n?: number; speed?: number[]; angle?: number; spread?: number; pal?: Rgb[]; g?: number; life?: number[]; size?: number[]; drag?: number; tail?: number; crackle?: number };

function sprite(rgb: string, r = 16) {
  const c = document.createElement('canvas'); c.width = c.height = r * 2;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.22, `rgba(${rgb},.5)`); gr.addColorStop(0.55, `rgba(${rgb},.12)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2);
  return c;
}

class Sky {
  P: Spark[] = []; C: Comet[] = []; R: Ring[] = []; F: Shell[] = []; G: Group[] = [];
  ctx: CanvasRenderingContext2D | null = null; raf = 0; last = 0; h = 1080; timers: number[] = [];
  GLOW = { white: sprite('255,255,255', 32), gold: sprite('255,214,130', 32), ice: sprite('170,205,245', 32) };
  // `need(true)` asks for the canvas to be put up; `need(false)` says it can come down.
  constructor(private need: (on: boolean) => void) {}
  attach(c: HTMLCanvasElement | null) {
    if (!c) { this.ctx = null; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; return; }
    this.h = Math.round((1920 * window.innerHeight) / Math.max(1, window.innerWidth));
    c.width = 1920; c.height = this.h;
    this.ctx = c.getContext('2d');
    if (this.busy()) this.wake();
  }
  dispose() { this.timers.forEach((t) => window.clearTimeout(t)); this.timers = []; if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
  later(ms: number, fn: () => void) { this.timers.push(window.setTimeout(fn, ms)); }
  busy() { return !!(this.P.length || this.C.length || this.R.length || this.F.length || this.G.length); }
  // Reduced motion: nothing flies.
  still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  wake() {
    if (this.still) { this.P = []; this.C = []; this.R = []; this.F = []; this.G = []; return; }
    if (!this.ctx) { this.need(true); return; }
    if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.step); }
  }
  step = (now: number) => {
    const ctx = this.ctx;
    if (!ctx) { this.raf = 0; return; }
    // A frame's time can be a touch before the moment it was asked for: never step backwards.
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000)); this.last = Math.max(this.last, now);
    ctx.clearRect(0, 0, 1920, this.h);
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    this.drawText(ctx, dt, now / 1000); this.drawShells(ctx, dt); this.drawComets(ctx, dt); this.drawSparks(ctx, dt); this.drawRings(ctx, dt);
    ctx.globalAlpha = 1;
    if (this.busy()) this.raf = requestAnimationFrame(this.step);
    else { this.raf = 0; ctx.clearRect(0, 0, 1920, this.h); this.need(false); }
  };
  // An element's point on the 1920 stage (fx, fy: 0..1 across it).
  pt(el: Element, fx = 0.5, fy = 0.5): Pt {
    const k = 1920 / Math.max(1, window.innerWidth), r = el.getBoundingClientRect();
    return [(r.left + r.width * fx) * k, (r.top + r.height * fy) * k];
  }

  drawSparks(ctx: CanvasRenderingContext2D, dt: number) {
    this.P = this.P.filter((p) => (p.age += dt) < p.life);
    for (const p of this.P) {
      const t = p.age / p.life;
      if (p.mote) {
        p.vx += Math.sin(p.age * p.w + p.ph) * p.sway * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const a = Math.min(1, t / 0.15) * (1 - t) * p.o;
        ctx.globalAlpha = a * 0.5; ctx.drawImage(p.glow, p.x - p.s * 4, p.y - p.s * 4, p.s * 8, p.s * 8);
        ctx.globalAlpha = a; ctx.fillStyle = `rgb(${tint(p.pal, 0.15 + t * 0.5)})`; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      let a = 1 - t * t;
      if (p.crackle && t > 0.55) a *= Math.random() < 0.45 ? 1 : 0.1;
      ctx.globalAlpha = a; ctx.strokeStyle = `rgb(${tint(p.pal, t)})`; ctx.lineWidth = p.s * (1 - t * 0.55);
      ctx.beginPath(); ctx.moveTo(p.x - p.vx * p.tail, p.y - p.vy * p.tail); ctx.lineTo(p.x, p.y); ctx.stroke();
      if (p.glint && t < 0.7) { ctx.globalAlpha = a * 0.8; ctx.drawImage(p.glint, p.x - 7, p.y - 7, 14, 14); }
    }
  }
  // A burst of sparks from (x, y), thrown along `angle` (degrees, 0 = right, -90 = up).
  burst(x: number, y: number, { n = 24, speed = [220, 620], angle = -90, spread = 150, pal = GOLD, g = 900, life = [0.35, 0.9], size = [1.4, 2.8], drag = 1.6, tail = 0.04, crackle = 0 }: BurstOpts = {}) {
    if (this.P.length > 1600) return;
    for (let i = 0; i < n; i++) {
      const a = ((angle + rnd(-spread / 2, spread / 2)) * Math.PI) / 180, v = rnd(speed[0], speed[1]);
      this.P.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g, drag, pal, tail, life: rnd(life[0], life[1]), s: rnd(size[0], size[1]), crackle: Math.random() < crackle, age: 0 });
    }
    this.wake();
  }
  // Motes drifting from a box: fireflies, dust in a light beam.
  motes(x0: number, x1: number, y0: number, y1: number, n: number, pal = WARM, { vy = [-20, -60], life = [1.6, 3.2], size = [1.2, 2.2], o = 0.85 } = {}) {
    if (this.P.length > 1600) return;
    for (let i = 0; i < n; i++) {
      this.P.push({ mote: true, x: rnd(x0, x1), y: rnd(y0, y1), vx: rnd(-10, 10), vy: rnd(vy[0], vy[1]), sway: rnd(14, 40), w: rnd(1.2, 3), ph: rnd(0, 6),
        pal, life: rnd(life[0], life[1]), s: rnd(size[0], size[1]), o, glow: this.GLOW.gold, age: 0 });
    }
    this.wake();
  }
  flash(x: number, y: number, r = 90, life = 0.4, glow = this.GLOW.white) { this.R.push({ flash: true, x, y, r, life, glow, age: 0 }); this.wake(); }
  ring(x: number, y: number, r0 = 6, r1 = 90, life = 0.6, rgb = '255,236,190', w = 2.4) { this.R.push({ x, y, r0, r1, life, rgb, w, age: 0 }); this.wake(); }
  drawRings(ctx: CanvasRenderingContext2D, dt: number) {
    this.R = this.R.filter((r) => (r.age += dt) < r.life);
    for (const r of this.R) {
      const k = r.age / r.life;
      if (r.flash) { const s = r.r * (0.6 + 0.4 * easeOut(k)); ctx.globalAlpha = (1 - k) ** 2; ctx.drawImage(r.glow, r.x - s, r.y - s, s * 2, s * 2); continue; }
      ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = `rgb(${r.rgb})`; ctx.lineWidth = r.w * (1 - k) + 0.4;
      ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(0, r.r0 + (r.r1 - r.r0) * easeOut(k)), 0, 6.2832); ctx.stroke();
    }
  }
  // A comet: a head that runs path(u) over `dur` seconds with a fading tail.
  comet(path: (u: number) => Pt, dur: number, { size = 3, glow = this.GLOW.gold, trail = 24, ease = (u: number) => u, debris = 0, pal = GOLD, onEnd, delay = 0 }:
    { size?: number; glow?: HTMLCanvasElement; trail?: number; ease?: (u: number) => number; debris?: number; pal?: Rgb[]; onEnd?: (x: number, y: number) => void; delay?: number } = {}) {
    this.C.push({ path, dur, size, glow, trail, ease, debris, pal, onEnd, age: -delay, tr: [], done: false });
    this.wake();
  }
  drawComets(ctx: CanvasRenderingContext2D, dt: number) {
    for (const c of this.C) {
      c.age += dt;
      if (c.age < 0) continue;
      if (!c.done) {
        const u = clamp01(c.age / c.dur), [x, y] = c.path(c.ease(u));
        c.tr.push([x, y]); if (c.tr.length > c.trail) c.tr.shift();
        if (c.debris && Math.random() < c.debris) this.P.push({ x, y, vx: rnd(-40, 40), vy: rnd(-40, 40), g: 60, drag: 2, pal: c.pal, tail: 0.02, life: rnd(0.3, 0.7), s: rnd(0.8, 1.6), age: 0 });
        if (u >= 1) { c.done = true; c.onEnd?.(x, y); }
      } else c.tr.shift();
      const n = c.tr.length;
      for (let i = 1; i < n; i++) {
        const k = i / n;
        ctx.globalAlpha = k * k * 0.9; ctx.strokeStyle = `rgb(${tint(c.pal, 1 - k)})`; ctx.lineWidth = c.size * k * 1.5;
        ctx.beginPath(); ctx.moveTo(c.tr[i - 1][0], c.tr[i - 1][1]); ctx.lineTo(c.tr[i][0], c.tr[i][1]); ctx.stroke();
      }
      if (!c.done && n) {
        const [x, y] = c.tr[n - 1], s = c.size * 9;
        ctx.globalAlpha = 1; ctx.drawImage(c.glow, x - s, y - s, s * 2, s * 2);
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, c.size * 0.8, 0, 6.2832); ctx.fill();
      }
    }
    this.C = this.C.filter((c) => !(c.done && !c.tr.length));
  }
  // Fireworks: a shell climbs from (x, y0) to (x, y1), then breaks.
  shell(x: number, y0: number, y1: number, { pal = GOLD, n = 72, kind = 'peony', delay = 0, speed = 300 } = {}) {
    this.F.push({ x, y: y0, x0: x, y0, y1, pal, n, kind, speed, dur: rnd(0.55, 0.8), age: -delay });
    this.wake();
  }
  breakShell(s: Shell) {
    const glint = s.pal === ICE ? this.GLOW.ice : this.GLOW.gold;
    this.flash(s.x, s.y, 120, 0.45, glint);
    const willow = s.kind === 'willow', ring = s.kind === 'ring';
    for (let i = 0; i < s.n; i++) {
      const a = (i / s.n) * 6.2832 + rnd(-0.04, 0.04), v = s.speed * (ring ? 1 : rnd(0.55, 1));
      this.P.push({ x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: willow ? 150 : 230, drag: willow ? 2.4 : 1.5, pal: s.pal, tail: willow ? 0.08 : 0.045,
        life: willow ? rnd(1.8, 2.6) : rnd(1.0, 1.6), s: willow ? rnd(1.4, 2) : rnd(2, 3), crackle: Math.random() < (willow ? 0.5 : 0.25),
        glint: !willow && Math.random() < 0.3 ? glint : null, age: 0 });
    }
    if (s.kind === 'peony') for (let i = 0; i < 18; i++) {   // a bright heart
      const a = rnd(0, 6.2832), v = rnd(40, 110);
      this.P.push({ x: s.x, y: s.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 120, drag: 2, pal: WARM, tail: 0.03, life: rnd(0.5, 0.9), s: 2, age: 0 });
    }
  }
  drawShells(ctx: CanvasRenderingContext2D, dt: number) {
    for (const s of this.F) {
      s.age += dt;
      if (s.age < 0) continue;
      const k = clamp01(s.age / s.dur);
      s.y = s.y0 + (s.y1 - s.y0) * (1 - (1 - k) ** 2); s.x = s.x0 + Math.sin(k * 9) * 2;
      if (Math.random() < 0.8) this.P.push({ x: s.x, y: s.y, vx: rnd(-14, 14), vy: rnd(10, 50), g: 80, drag: 2, pal: WARM, tail: 0.02, life: rnd(0.25, 0.5), s: 1.3, age: 0 });
      ctx.globalAlpha = 1; ctx.drawImage(this.GLOW.gold, s.x - 8, s.y - 8, 16, 16);
      if (k >= 1) { s.gone = true; this.breakShell(s); }
    }
    this.F = this.F.filter((s) => !s.gone);
  }

  /* Star text: the words are drawn off screen in the face, size and spacing the page shows them in, and
     sampled; every lit point is a star's place. The stars fly there, rest (twinkling) while the crisp
     words fade in under them, then blow away. */
  sampleText(els: Element[], max = 1400, step = 3): Pt[] {
    const k = 1920 / Math.max(1, window.innerWidth), pts: Pt[] = [];
    for (const el of els) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      const text = cs.textTransform === 'uppercase' ? (el.textContent ?? '').toUpperCase() : el.textContent ?? '';
      if (!r.width || !text.trim()) continue;
      const c = document.createElement('canvas'), g = c.getContext('2d');
      if (!g) continue;
      // Set the face at its own size, then scale it to the width it is drawn at (whatever zoom it sits under).
      const fs0 = parseFloat(cs.fontSize) || 16, ls0 = parseFloat(cs.letterSpacing) || 0;
      const face = (fs: number, ls: number) => { g.font = `${cs.fontWeight} ${fs}px ${cs.fontFamily}`; if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`; };
      face(fs0, ls0);
      const z = (r.width * k) / Math.max(1, g.measureText(text).width);
      const W = Math.ceil(r.width * k) + 24, H = Math.ceil(r.height * k) + 8;
      c.width = W; c.height = H;
      face(fs0 * z, ls0 * z);
      const m = g.measureText(text), A = m.fontBoundingBoxAscent || fs0 * z * 0.8, D = m.fontBoundingBoxDescent || fs0 * z * 0.2;
      const by = (r.height * k - (A + D)) / 2 + A;
      g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
      g.fillText(text, 0, by);
      const d = g.getImageData(0, 0, W, H).data, x0 = r.left * k, y0 = r.top * k;
      for (let y = 0; y < H; y += step) for (let x = (y / step) % 2 ? step / 2 : 0; x < W; x += step) {
        if (d[((y | 0) * W + (x | 0)) * 4 + 3] > 150) pts.push([x0 + x + rnd(-0.7, 0.7), y0 + y + rnd(-0.7, 0.7)]);
      }
    }
    for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
    return pts.slice(0, max);
  }
  mkStar(x: number, y: number): Star {
    const r = Math.random();
    return { x, y, px: x, py: y, sx: x, sy: y, tx: x, ty: y, dl: 0, du: 1, cu: 0, s: rnd(1.1, 2.2), ph: rnd(0, 6.28), w: rnd(1.4, 4.2),
      c: r < 0.58 ? 0 : r < 0.82 ? 1 : 2, glow: Math.random() < 0.09, fa: 1, fi: 0, age: 0, mode: 'idle' };
  }
  // A group of idle stars scattered over a box (they fade in, then twinkle).
  starField(n: number, [x0, y0, x1, y1]: number[], fadeIn = 1.4) {
    const g: Group = { stars: [], dim: 1, dimTo: 1, age: 0 };
    for (let i = 0; i < n; i++) { const s = this.mkStar(rnd(x0, x1), rnd(y0, y1)); s.fa = 0; s.fi = rnd(0.2, fadeIn); g.stars.push(s); }
    g.stars.sort((a, b) => a.c - b.c);
    this.G.push(g); this.wake();
    return g;
  }
  // Send stars to the points: the group's idle stars first, then new ones from `from()`.
  assemble(g0: Group | null, pts: Pt[], { from, fly = [0.9, 1.4], delay = [0, 0.35], curl = 70 }: { from: () => Pt; fly?: number[]; delay?: number[]; curl?: number }) {
    const g = g0 ?? { stars: [], dim: 1, dimTo: 1, age: 0 };
    const idle = g.stars.filter((s) => s.mode === 'idle');
    pts.forEach(([tx, ty], i) => {
      let s = idle[i];
      if (!s) { const [x, y] = from(); s = this.mkStar(x, y); s.fa = 0; s.fi = 0.25; g.stars.push(s); }
      Object.assign(s, { sx: s.x, sy: s.y, px: s.x, py: s.y, tx, ty, dl: rnd(delay[0], delay[1]), du: rnd(fly[0], fly[1]), cu: rnd(-curl, curl), age: 0, mode: 'fly' });
    });
    g.stars.sort((a, b) => a.c - b.c);
    if (!this.G.includes(g)) this.G.push(g);
    this.wake();
    return g;
  }
  scatter(g: Group | null, { wind = 0, lift = -90 } = {}) {
    if (!g) return;
    for (const s of g.stars) Object.assign(s, { mode: 'gone', age: 0, vx: rnd(-50, 50) + wind, vy: rnd(-40, 10) + lift * rnd(0.4, 1.3), sl: rnd(0.8, 1.6) });
    g.dimTo = g.dim;
  }
  drawText(ctx: CanvasRenderingContext2D, dt: number, T: number) {
    for (const g of this.G) {
      g.age += dt; g.dim += (g.dimTo - g.dim) * Math.min(1, dt * 2.5);
      let col = -1;
      for (const s of g.stars) {
        s.age += dt;
        if (s.fa < 1) s.fa = Math.min(1, s.fa + dt / Math.max(0.05, s.fi || 0.05));
        let a = 0, x: number, y: number;
        if (s.mode === 'fly') {
          const u = clamp01((s.age - s.dl) / s.du), e = easeIO(u);
          const dx = s.tx - s.sx, dy = s.ty - s.sy, L = Math.hypot(dx, dy) || 1, off = s.cu * Math.sin(Math.PI * e);
          x = s.sx + dx * e - (dy / L) * off; y = s.sy + dy * e + (dx / L) * off;
          if (u >= 1) { s.mode = 'rest'; x = s.tx; y = s.ty; }
          a = s.fa * (u > 0 && u < 1 ? 1 : 0.8);
          if (u > 0 && u < 1) {
            ctx.globalAlpha = a; ctx.strokeStyle = `rgb(${STAR_RGB[s.c]})`; ctx.lineWidth = s.s * 0.9;
            ctx.beginPath(); ctx.moveTo(s.px, s.py); ctx.lineTo(x, y); ctx.stroke();
            s.px = x; s.py = y; s.x = x; s.y = y; col = -1; continue;
          }
          s.px = x; s.py = y;
        } else if (s.mode === 'gone') {
          s.vy! -= 20 * dt; s.x += s.vx! * dt; s.y += s.vy! * dt; x = s.x; y = s.y;
          a = s.fa * Math.max(0, 1 - s.age / s.sl!) * g.dim;
          if (a <= 0) { s.dead = true; continue; }
        } else { x = s.mode === 'rest' ? s.tx : s.x; y = s.mode === 'rest' ? s.ty : s.y; }
        if (s.mode !== 'gone') a = s.fa * (0.5 + 0.5 * Math.sin(T * s.w + s.ph)) * (s.mode === 'rest' ? g.dim : 1);
        s.x = x; s.y = y;
        ctx.globalAlpha = a;
        if (s.glow) { const r = s.s * 4.5; ctx.drawImage(s.c === 2 ? this.GLOW.ice : this.GLOW.gold, x - r, y - r, r * 2, r * 2); col = -1; }
        if (col !== s.c) { ctx.fillStyle = `rgb(${STAR_RGB[s.c]})`; col = s.c; }
        ctx.fillRect(x - s.s / 2, y - s.s / 2, s.s, s.s);
      }
      g.stars = g.stars.filter((s) => !s.dead);
    }
    this.G = this.G.filter((g) => g.stars.length);
  }

  /* ---------- The moments ---------- */
  // A run: a meteor (one per run, up to four) out of the sky into the score; `from` a point to start at.
  landRun(well: Element, runs: number, right: boolean, from: Pt | null = null, delay = 0) {
    const [x1, y1] = this.pt(well);
    for (let i = 0; i < Math.min(runs, 4); i++) {
      const [x0, y0] = from ?? [x1 + (right ? -1 : 1) * rnd(360, 520), y1 - rnd(260, 380)];
      const c: Pt = [x0 + (x1 - x0) * 0.35, y0 + (y1 - y0) * 0.1 - 40];
      this.comet(quad([x0, y0], c, [x1, y1]), from ? 0.62 : 0.5, { size: 3, trail: 26, debris: 0.7, delay: delay + i * 0.17, ease: (u) => u * u * (0.5 + 0.5 * u) + u * 0.25 * (1 - u),
        onEnd: (x, y) => { this.flash(x, y, 80, 0.45); this.ring(x, y, 8, 70, 0.55); this.burst(x, y, { n: 18, spread: 360, g: 500, speed: [120, 420], life: [0.35, 0.8], size: [1.2, 2.4] }); } });
    }
  }
  // A hit or a walk: a comet runs the little diamond (svg viewBox 64 x 56) as far as it was worth.
  runBases(dia: Element, bases: number, ice: boolean) {
    const k = Math.min(4, bases), pal = ice ? ICE : GOLD;
    const pts = ([[32, 49], [51, 30], [32, 11], [13, 30], [32, 49]] as Pt[]).slice(0, k + 1).map(([x, y]) => this.pt(dia, x / 64, y / 56));
    this.comet(poly(pts), 0.3 + k * 0.2, { size: 1.8, trail: 16, glow: ice ? this.GLOW.ice : this.GLOW.gold, pal, ease: easeIO, debris: 0.3, onEnd: (x, y) => {
      this.ring(x, y, 4, 26, 0.45, ice ? '200,225,250' : '255,236,190', 1.8);
      this.burst(x, y, { n: 8, spread: 360, g: 200, speed: [60, 180], life: [0.25, 0.5], size: [1, 1.8], pal });
    } });
  }
  // The moonshot: the ball climbs off the diamond, bursts, and its stardust settles into the words; fireworks beside the banner.
  moonshot(root: HTMLElement, { big, top, right, color }: { big: boolean; top: boolean; right: boolean; color: string }) {
    const dia = root.querySelector('.dia'), hr = root.querySelector('.hrw .hr'), tx = [...root.querySelectorAll('.hrw .t1 .tx')];
    if (!hr || !tx.length) return;
    const pts = this.sampleText(tx, big ? 1500 : 1300);
    const [ax] = this.pt(tx[0], 0, 0.55), [bx, ty] = this.pt(tx[tx.length - 1], 1, 0.55), txc = (ax + bx) / 2;
    const [hx, hy] = dia ? this.pt(dia, 32 / 64, 49 / 56) : this.pt(hr, 0.1, top ? 0 : 1);
    this.flash(hx, hy, 50, 0.35); this.ring(hx, hy, 4, 40, 0.4);
    const apex = Math.min(hy, ty) - (top ? 150 : 260);
    let stars: Group | null = null;
    this.comet(quad([hx, hy], [(hx + txc) / 2 + (right ? 120 : -120), apex], [txc, ty]), 0.7, { size: 4, trail: 34, glow: this.GLOW.white, pal: WARM, debris: 0.9,
      ease: (u) => easeIO(u) * 0.7 + u * 0.3, delay: 0.1,
      onEnd: (x, y) => {
        this.flash(x, y, 260, 0.6); this.flash(x, y, 120, 0.9, this.GLOW.gold); this.ring(x, y, 10, 300, 0.9, '255,236,190', 3);
        this.burst(x, y, { n: 40, spread: 360, g: 250, speed: [200, 700], life: [0.4, 1.0], size: [1.2, 2.6], pal: WARM });
        stars = this.assemble(null, pts, { from: () => [x + rnd(-12, 12), y + rnd(-12, 12)], fly: [0.6, 0.9], delay: [0, 0.15], curl: 90 });
        (hr as HTMLElement).animate?.([{ transform: 'none' }, { transform: 'translate(-4px,2px)' }, { transform: 'translate(4px,-2px)' }, { transform: 'translate(-2px,1px)' }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
      } });
    this.later(1900, () => { if (stars) stars.dimTo = 0.55; });
    const [bx0, by0] = this.pt(hr, 0.06, 1), [bx1, by1] = this.pt(hr, 0.94, 0);
    const pals = [GOLD, ICE, palFrom(color), WARM], shells = big ? 7 : 4;
    for (let i = 0; i < shells; i++) {
      const x = bx0 + (bx1 - bx0) * ((i + 0.5) / shells) + rnd(-40, 40);
      const [y0, y1] = top ? [by0 + 280, by0 + rnd(50, 130)] : [by1 + 8, by1 - rnd(30, 110)];   // they bloom in the open sky beside the banner
      this.shell(x, y0, y1, { pal: pals[i % pals.length], kind: i % 3 === 2 ? 'willow' : i === 1 ? 'ring' : 'peony', delay: 2 + i * 0.25 + rnd(0, 0.15), n: rnd(56, 80) | 0, speed: rnd(240, 320) });
    }
    this.later(3400, () => { this.scatter(stars, { wind: right ? -60 : 60 }); stars = null; });
  }
  // A walk-off lights the whole sky.
  walkoff(color: string) {
    const pals = [GOLD, ICE, WARM, palFrom(color)], kinds = ['peony', 'willow', 'ring', 'peony'];
    for (let i = 0; i < 14; i++) this.shell(rnd(180, 1740), this.h + 20, rnd(140, 520), { pal: pals[i % 4], kind: kinds[i % 4], delay: 0.6 + i * 0.42 + rnd(0, 0.2), n: rnd(70, 96) | 0, speed: rnd(280, 380) });
  }
}

/* ---------- The intro (full frame) ---------- */
const BANKS: [number, number][] = [[16.67, -17], [42.67, -7], [85.33, 7], [111.33, 17]];   // left (rem), lean (deg)
const HTW = Array.from({ length: 40 }, (_, i) => {
  const r = (k: number) => hash(900 + i * 13 + k);
  return { left: `${(2 + r(1) * 96).toFixed(1)}%`, top: `${(r(2) < 0.5 ? 5 + r(3) * 19 : 80 + r(3) * 15).toFixed(1)}%`, '--d': `${(2.2 + r(4) * 3).toFixed(2)}s`, '--dl': `-${(r(5) * 5).toFixed(2)}s`, g: r(6) < 0.3 };
});

function Hero({ n, away, home, sky, moon, onLand }: { n: number; away: string; home: string; sky: React.RefObject<Sky | null>; moon: React.RefObject<HTMLDivElement | null>; onLand: (n: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const S = sky.current, el = box.current;
    if (!S || !el) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t: number[] = [], later = (ms: number, fn: () => void) => t.push(window.setTimeout(fn, ms));
    let stars: Group | null = null, dust = 0, anim: Animation | null = null;
    if (!still) {
      stars = S.starField(420, [40, 30, 1880, Math.max(300, S.h - 30)], 1.6);
      later(2500, () => {   // the stars gather into the words
        const w1 = el.querySelector('.w1 .tx');
        if (w1 && stars) S.assemble(stars, S.sampleText([w1], 1800, 3), { from: () => [rnd(0, 1920), rnd(-80, S.h + 20)], fly: [1.1, 1.7], delay: [0, 0.5], curl: 140 });
      });
      el.querySelectorAll('.lb .head').forEach((h, i) => later(4100 + i * 320, () => {   // ka-chunk
        const [x, y] = S.pt(h);
        S.flash(x, y, 220, 0.6); S.burst(x, y + 20, { n: 16, spread: 120, angle: 90, g: 700, speed: [80, 300], life: [0.3, 0.8], size: [1, 2], pal: WARM });
        if (i === 3 && stars) stars.dimTo = 0.5;
      }));
      later(4400, () => {
        const xs = [...el.querySelectorAll('.lb .head')].map((h) => S.pt(h)[0]);
        dust = window.setInterval(() => { for (const x of xs) S.motes(x - 260, x + 260, 250, 1000, 1, WARM, { vy: [-12, 12], life: [2, 3.6], size: [1, 2], o: 0.55 }); }, 180);
      });
      later(8000, () => { window.clearInterval(dust); S.scatter(stars, { lift: -140 }); stars = null; });
    }
    later(8600, () => {   // the big moon sets into the bug's
      const big = el.querySelector<HTMLElement>('.hmoon'), to = moon.current;
      if (!big || !to) return;
      const a = big.getBoundingClientRect(), b = to.getBoundingClientRect();
      anim = big.animate([{ transform: 'none' }, { transform: `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px,${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${b.height / Math.max(1, a.height)})` }],
        { duration: still ? 1 : 1200, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
    });
    later(9800, () => {
      onLand(n);
      const to = moon.current;
      if (!to || still) return;
      const [x, y] = S.pt(to);
      S.flash(x, y, 120, 0.5); S.ring(x, y, 20, 110, 0.7);
      S.burst(x, y, { n: 26, spread: 360, pal: WARM, g: 300, speed: [120, 380], life: [0.4, 0.9], size: [1, 2] });
    });
    return () => { t.forEach((x) => window.clearTimeout(x)); window.clearInterval(dust); anim?.cancel(); S.scatter(stars); };
  }, [n, sky, moon, onLand]);
  return (
    <div ref={box} className="hero">
      <i className="veil" />
      <div className="hsky">
        {HTW.map(({ g, ...st }, i) => <i key={i} className={g ? 'tw g' : 'tw'} style={st as V} />)}
        <i className="l1" /><i className="l2" />
      </div>
      <div className="hmoon mn"><Moon /></div>
      {BANKS.map(([x, r], i) => (
        <div key={i} className="lb" style={{ '--x': `${x}rem`, '--r': `${r}deg`, '--at': `${(4.1 + i * 0.32).toFixed(2)}s` } as V}>
          <i className="cone" /><i className="bloom" />
          <div className="head">{Array.from({ length: 24 }, (_, j) => <i key={j} style={{ '--j': (j * 7) % 24 } as V} />)}</div>
        </div>
      ))}
      <i className="flash" />
      <div className="word">
        <div className="w0">Tonight</div>
        <div className="w1"><span className="tx">Under the lights</span></div>
        {(away || home) && <div className="w2"><i /><span>{away}</span><em>at</em><span>{home}</span><i /></div>}
      </div>
    </div>
  );
}

function Moon({ flare, extra }: { flare?: string | number; extra?: boolean }) {
  // The halo is remounted when a run scores, and flares once; a big play adds a flare of its own.
  return (
    <>
      <i key={flare} className="halo" />{extra && <i className="halo x" />}
      <svg viewBox="0 0 100 100" aria-hidden="true"><use href="#lkmnMoon" /></svg>
      <i className="cl" /><i className="cl" />
    </>
  );
}

function Stars({ tw }: { tw: typeof TW }) {
  return (
    <>
      {tw.map(([l, t, d, dl, g], i) => <i key={i} className={g ? 'tw g' : 'tw'} style={{ left: `${l}%`, top: `${t}%`, '--d': `${d}s`, '--dl': `-${dl}s` } as V} />)}
      <i className="l1" /><i className="l2" />
    </>
  );
}

const isRight = (el: Element) => !!el.closest('.ov.bug-br, .ov.bug-tr');

export function MidnightBug({ g, air, away, home, abbrs, status, period, showLine, moment, topEdge, intro, fx, rally: rallyOn }: BugProps) {
  const live = status === 'live', top = g.half === 'top', ball = period === null;
  const bases = g.bases as { first?: boolean; second?: boolean; third?: boolean };
  const balls = g.balls | 0, strikes = g.strikes | 0, outs = g.outs | 0;
  const inning = Number(g.inning) || 1;
  const half = `${g.inning}${g.half}`;
  const runs = (g.away_score | 0) + (g.home_score | 0);
  const dots = (n: number, of: number) => Array.from({ length: of }, (_, i) => <i key={`${i}${i < n ? 1 : 0}`} className={i < n ? 'on pop' : undefined} />);
  const base = (on: boolean | undefined, x: number, y: number, cx: number, cy: number, k: string) => (
    <g key={`${k}${on ? 1 : 0}`} transform={`rotate(45 ${cx} ${cy})`}><rect className={on ? 'b on pop' : 'b'} x={x} y={y} width="13" height="13" /></g>
  );
  const walkoff = fx?.kind === 'walkoff' ? fx.n : null;
  const team = (side: 'away' | 'home') => {
    const brand = side === 'away' ? away : home, score = (side === 'away' ? g.away_score : g.home_score) | 0;
    const bat = ball && live && (side === 'away') === top;
    const win = walkoff !== null && (side === 'away') === top;
    return (
      <div className={`team${bat ? ' bat' : ''}${win ? ' win' : ''}`} style={{ '--tc': brand.color } as V}>
        <i className="pip" /><span className="ab">{tabName(brand, abbrs[side])}</span>
        <div key={score} className="score"><span className="roll"><b>{score}</b></span></div>
      </div>
    );
  };
  const k = moment?.text.startsWith('Strikeout') ? moment : null;
  const looking = !!k && k.text.endsWith('looking');
  const hr = moment?.text === 'Home run' ? moment : null;
  const mkey = moment ? `${moment.text}${moment.who}` : '';
  const tag = moment ? TAG[moment.text] ?? [moment.text, 'ice', ''] : null;
  const run = moment ? BASES[moment.text] ?? 0 : 0;
  const big = !!hr || moment?.text === 'Double' || moment?.text === 'Triple';
  const bat = air.batter, pit = air.pitcher;
  const batBrand = top ? away : home;
  const said = k && k.who ? `${k.who} ${looking ? 'caught looking' : 'strikes out'}` : moment && moment.text === 'Walk' && moment.who ? `${moment.who} takes first` : moment?.who || tag?.[2];
  // The moon that rises in the inning box says what just ended.
  const rise: [string, number] = !top ? ['MID', inning] : inning > 1 ? ['END', inning - 1] : ['TOP', 1];
  const kWho = k ? [surname(k.who), pit?.last].filter(Boolean).join(' · ') : '';

  // The sky over the picture: made once, its canvas put up only while something is in the air.
  const root = useRef<HTMLDivElement>(null), moon = useRef<HTMLDivElement>(null), sky = useRef<Sky | null>(null);
  const [fly, setFly] = useState(false);
  useEffect(() => { const S = new Sky(setFly); sky.current = S; return () => { S.dispose(); sky.current = null; }; }, []);
  const attach = useCallback((c: HTMLCanvasElement | null) => sky.current?.attach(c), []);
  // The intro: the bug waits hidden while it plays, then opens out of the moon that sets into it.
  const show = useShow(intro?.n, 10800);
  const [landed, setLanded] = useState<number | null>(null);
  const hiding = show !== null && landed !== show;
  // A rally (the pad's Rally switch, as in v4; bases loaded; or the walk-off itself): an aurora in the plate, fireflies off it.
  const rally = !!rallyOn || (ball && live && !!bases.first && !!bases.second && !!bases.third) || walkoff !== null;
  const batColor = batBrand.color;

  // A run: a meteor lands in the score (after a home run, it falls out of the banner's words).
  const aw = g.away_score | 0, hm = g.home_score | 0, homer = !!hr;
  const prev = useRef<{ away: number; home: number } | null>(null);
  useEffect(() => {
    const was = prev.current, S = sky.current, el = root.current;
    prev.current = { away: aw, home: hm };
    if (!was || !S || !el) return;
    const right = isRight(el);
    ([['away', aw], ['home', hm]] as const).forEach(([side, now], i) => {
      const n = now - was[side];
      const well = () => el.querySelectorAll('.rail .team .score')[i];
      if (n <= 0) return;
      if (homer) S.later(2200, () => { const tx = el.querySelectorAll('.hrw .t1 .tx'), w = well(); if (w) S.landRun(w, n, right, tx.length ? S.pt(tx[tx.length >> 1]) : null); });
      else { const w = well(); if (w) S.landRun(w, n, right); }
    });
  }, [aw, hm, homer]);

  // A play: the moonshot, a comet round the diamond, the strikeout bank's bulbs throwing sparks. Once per play.
  const fired = useRef('');
  useEffect(() => {
    const S = sky.current, el = root.current;
    if (!moment) { fired.current = ''; return; }
    if (!S || !el || fired.current === mkey) return;
    fired.current = mkey;
    if (moment.text === 'Home run') S.moonshot(el, { big: moment.runs >= 4, top: topEdge, right: isRight(el), color: batColor });
    else if (BASES[moment.text]) { const dia = el.querySelector('.dia'); if (dia) S.runBases(dia, BASES[moment.text], moment.text === 'Walk' || moment.text === 'Hit by pitch'); }
    else if (moment.text.startsWith('Strikeout')) {
      const lk = moment.text.endsWith('looking');
      [512, 866].forEach((ms) => S.later(ms, () => {
        const bank = el.querySelector('.kw .bank');
        if (bank) { const [x, y] = S.pt(bank, lk ? 0.8 : 0.2, 0.5); S.burst(x, y, { n: 10, spread: 360, g: 300, speed: [80, 260], life: [0.25, 0.6], size: [1, 1.8], pal: WARM }); }
      }));
    }
  }, [mkey, moment, topEdge, batColor]);

  // A walk-off lights the whole sky.
  const firedWo = useRef<number | null>(null);
  useEffect(() => {
    if (walkoff === null || firedWo.current === walkoff) return;
    firedWo.current = walkoff;
    sky.current?.walkoff(batColor);
  }, [walkoff, batColor]);

  // An out: a ring off its light. The half turning: the small moon flashes as it rises.
  const prevOuts = useRef<number | null>(null), prevHalf = useRef<string | null>(null);
  useEffect(() => {
    const was = prevOuts.current, S = sky.current, el = root.current;
    prevOuts.current = outs;
    if (was === null || outs <= was || !S || !el || !live) return;
    S.later(40, () => {
      const d = el.querySelectorAll('.bso .o i')[Math.min(outs, 2) - 1];
      if (d) { const [x, y] = S.pt(d); S.ring(x, y, 4, 24, 0.45, '255,226,160', 1.6); S.burst(x, y, { n: 8, spread: 360, pal: GOLD, g: 150, speed: [60, 180], life: [0.25, 0.5], size: [1, 1.8] }); }
    });
  }, [outs, live]);
  useEffect(() => {
    const was = prevHalf.current, S = sky.current, el = root.current;
    prevHalf.current = half;
    if (was === null || was === half || !S || !el) return;
    S.later(700, () => { const r = el.querySelector('.inn .rise'); if (r) { const [x, y] = S.pt(r); S.flash(x, y, 50, 0.6); } });
  }, [half]);

  // Rally: fireflies drift off the plate.
  const heroOn = show !== null;
  useEffect(() => {
    const S = sky.current, el = root.current;
    if (!rally || heroOn || !S || !el) return;
    const t = window.setInterval(() => {
      const plate = el.querySelector('.plate');
      if (!plate) return;
      const [x0, y] = S.pt(plate, 0.04, topEdge ? 1 : 0), [x1] = S.pt(plate, 0.96, 0);
      S.motes(x0, x1, y - 4, y + 4, 2, Math.random() < 0.7 ? WARM : ICE, { vy: topEdge ? [20, 60] : [-30, -80], life: [1.4, 2.6], size: [1.2, 2.2] });
    }, 280);
    return () => window.clearInterval(t);
  }, [rally, heroOn, topEdge]);

  return (
    <div ref={root} className={`lk-mn${hiding ? ' await' : landed !== null ? ' landed' : ''}${rally ? ' rally' : ''}`}>
      {(fly || show !== null) && (
        <FullFrame className="lkmn-ff" watch>
          {show !== null && <Hero key={show} n={show} away={abbrs.away || away.display.toUpperCase()} home={abbrs.home || home.display.toUpperCase()} sky={sky} moon={moon} onLand={setLanded} />}
          <canvas ref={attach} className="lkmn-sky" />
        </FullFrame>
      )}
      {/* The moon, drawn once and used wherever it appears. */}
      <svg className="defs" width="0" height="0" aria-hidden="true">
        <defs>
          <radialGradient id="lkmnLit" cx="36%" cy="40%" r="70%">
            <stop offset="0" stopColor="#fffdf5" /><stop offset=".45" stopColor="#f5eacb" /><stop offset=".8" stopColor="#dccb9c" /><stop offset="1" stopColor="#bfae80" />
          </radialGradient>
          <radialGradient id="lkmnDark" cx="64%" cy="34%" r="72%"><stop offset="0" stopColor="#2a3550" /><stop offset="1" stopColor="#151c2e" /></radialGradient>
          <radialGradient id="lkmnCr" cx="45%" cy="40%" r="60%">
            <stop offset="0" stopColor="#b3a273" stopOpacity=".15" /><stop offset=".7" stopColor="#a38f62" stopOpacity=".55" /><stop offset="1" stopColor="#8f7c52" stopOpacity=".2" />
          </radialGradient>
          <filter id="lkmnSoft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" /></filter>
          <mask id="lkmnMask" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
            <rect width="100" height="100" fill="#fff" /><circle cx="73" cy="33" r="36" fill="#000" filter="url(#lkmnSoft)" />
          </mask>
          <symbol id="lkmnMoon" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="url(#lkmnDark)" opacity=".8" />
            <g mask="url(#lkmnMask)">
              <circle cx="50" cy="50" r="40" fill="url(#lkmnLit)" />
              <circle cx="33" cy="58" r="8.5" fill="url(#lkmnCr)" /><circle cx="47" cy="76" r="5.5" fill="url(#lkmnCr)" /><circle cx="22" cy="42" r="4.6" fill="url(#lkmnCr)" />
              <circle cx="29" cy="75" r="3.2" fill="url(#lkmnCr)" /><circle cx="59" cy="66" r="3.6" fill="url(#lkmnCr)" /><circle cx="18" cy="58" r="2.4" fill="url(#lkmnCr)" />
            </g>
            <circle cx="50" cy="50" r="39.6" fill="none" stroke="rgba(255,255,255,.14)" strokeWidth="0.8" />
          </symbol>
        </defs>
      </svg>
      <div className="pkg">
        <div ref={moon} className="mn"><Moon flare={`${runs}${landed ?? ''}`} extra={!!k || !!hr} /></div>
        <div className="main">
          <div className="xstack">
            <div className="plate"><div className="rail">
              <div className="sky"><Stars tw={TW} /><i className="aur" /><i className="aur a2" /><i className="shoot idle" /></div>
              {team('away')}{team('home')}
              {!live ? <div className="sit word">{status === 'final' ? 'Final' : 'Pregame'}</div>
                : !ball ? <div className="sit word">{period}</div> : (
                  <div className="sit">
                    {/* Between halves a small moon rises over the inning, then sets. */}
                    <div key={half} className="inn">
                      <i className={top ? 'arr up on' : 'arr up'} /><span className="n">{g.inning}</span><i className={top ? 'arr dn' : 'arr dn on'} />
                      <div className="rise"><small>{rise[0]}</small><b>{rise[1]}</b></div>
                    </div>
                    <svg className="dia" viewBox="0 0 64 56" aria-hidden="true">
                      <path className="path" d="M32 49 L51 30 L32 11 L13 30 Z" />
                      <path className="plateH" d="M28.5 46.5 h7 v3.2 l-3.5 3 l-3.5 -3 z" />
                      {run > 0 && <path key={mkey} className={moment?.text === 'Walk' || moment?.text === 'Hit by pitch' ? 'trace ice' : 'trace'} pathLength={4} d="M32 49 L51 30 L32 11 L13 30 L32 49" style={{ '--k': run } as V} />}
                      {base(bases.second, 25.5, 4.5, 32, 11, 's')}{base(bases.third, 6.5, 23.5, 13, 30, 't')}{base(bases.first, 44.5, 23.5, 51, 30, 'f')}
                    </svg>
                    <div className="bso">
                      <em>B</em><div className="dots b">{dots(balls, 3)}</div>
                      <em>S</em><div className="dots s">{dots(strikes, 2)}</div>
                      <em>O</em><div className="dots o">{dots(outs, 2)}</div>
                    </div>
                  </div>
                )}
              {/* The searchlight: when a run scores or the half turns, and again for a big play. */}
              <i key={`${runs}${half}`} className="sweep" />{big && <i key={mkey} className="sweep" />}
            </div></div>
            {ball && live && (
              <div className="strip">
                {tag ? (
                  <div key={`t${mkey}`} className="line in"><span className={`xtag ${tag[1]}`}>{tag[0]}</span><span className="txt">{said}</span></div>
                ) : (
                  <div key={bat?.bid ?? half} className="line in">
                    {bat ? <><span className="xtag">AB</span><span className="txt">{bat.name}</span></>
                      : <><span className="xtag">{top ? 'Top' : 'Bot'} {g.inning}</span><span className="txt">{outs === 1 ? '1 out' : `${Math.min(outs, 2)} outs`}</span></>}
                    {bat && showLine && bat.avg && <span className="xtag hot">{bat.avg}</span>}
                    {bat && showLine && bat.today && <span className="side today">{bat.today}</span>}
                    {pit && <span className="side">P · {pit.last}{!!pit.pitches && <b>{pit.pitches}</b>}</span>}
                  </div>
                )}
              </div>
            )}
          </div>
          {k && (
            <div key={mkey} className="kw">
              <div className="kflag"><div className="kin">
                <div className="bank">
                  {Array.from({ length: 35 }, (_, n) => {
                    const i = K_ORDER.findIndex(([c, r]) => r * 5 + (looking ? 4 - c : c) === n);
                    return i < 0 ? <i key={n} /> : <i key={n} className="on" style={{ '--on': `${260 + i * 42 + (i >= 7 ? 60 : 0)}ms`, '--off': `${3050 + (K_ORDER.length - 1 - i) * 26}ms` } as V} />;
                  })}
                </div>
                <div className="kt"><b>{looking ? 'Called strike three' : 'Strikes out swinging'}</b>{kWho && <small>{kWho}</small>}</div>
              </div></div>
            </div>
          )}
          {hr && (
            <div key={mkey} className="hrw">
              <div className="hr"><div className="hin">
                <div className="sky"><Stars tw={TW_HR} /></div>
                <i className="beam b1" /><i className="beam b2" />
                <div className="bigmoon mn"><Moon /></div>
                <div className="hbody">
                  <div className="t1">{[...'Home run'].map((c, i) => (c === ' ' ? <span key={i} className="sp" /> : <span key={i} className="tx" style={{ '--i': i } as V}>{c}</span>))}</div>
                  <div className="t2" style={{ '--tc': batBrand.color } as V}>
                    <i /><b>{[hr.who, tabName(batBrand, top ? abbrs.away : abbrs.home)].filter(Boolean).join(' · ')}</b><span>{homerText(hr.runs, 'shot') || 'Moonshot'}</span>
                  </div>
                </div>
              </div></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
