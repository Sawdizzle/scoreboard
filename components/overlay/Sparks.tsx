'use client';

import { useEffect, useRef } from 'react';

// Blue Steel's forge: sparks off a struck score, a stamped home run and a cut
// strikeout, and embers drifting up after. One canvas over the whole picture,
// awake only while something is flying. Ported from Scoreboard's Blue Steel
// bug (public/bugs/bluesteel.html); positions and speeds are in its units, a
// 1920-wide stage, whatever size the source is.
type Rgb = [number, number, number];
const HOT: Rgb[] = [[255, 252, 238], [255, 220, 160], [255, 165, 95], [224, 121, 74], [120, 40, 20]];
const COLD: Rgb[] = [[255, 255, 255], [220, 243, 255], [170, 216, 248], [127, 192, 239], [40, 80, 125]];
type P = { x: number; y: number; vx: number; vy: number; life: number; s: number; age: number; pal: Rgb[] } &
  ({ ember: true; sway: number; w: number; ph: number; o: number } | { ember?: false; g: number; drag: number });
type Burst = { n?: number; speed?: [number, number]; angle?: number; spread?: number; pal?: Rgb[]; g?: number; life?: [number, number]; size?: [number, number]; drag?: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const tint = (pal: Rgb[], t: number) => {
  const x = Math.min(pal.length - 1.001, Math.max(0, t) * (pal.length - 1)), i = x | 0, f = x - i, a = pal[i], b = pal[i + 1];
  return `${(a[0] + (b[0] - a[0]) * f) | 0},${(a[1] + (b[1] - a[1]) * f) | 0},${(a[2] + (b[2] - a[2]) * f) | 0}`;
};

export function Sparks({ away, home, moment, top }: { away: number; home: number; moment: string | null; top: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fx = useRef<{ burst: (x: number, y: number, o?: Burst) => void; embers: (x0: number, x1: number, y: number, n: number, pal?: Rgb[], vy?: [number, number]) => void;
    pt: (el: Element, fx?: number, fy?: number) => [number, number]; later: (ms: number, fn: () => void) => void } | null>(null);
  const prev = useRef<{ away: number; home: number } | null>(null);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    let list: P[] = [], raf = 0, last = 0, h = 1080;
    const timers: number[] = [];
    const size = () => { h = Math.round((1920 * window.innerHeight) / Math.max(1, window.innerWidth)); c.width = 1920; c.height = h; };
    size();
    window.addEventListener('resize', size);
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      ctx.clearRect(0, 0, 1920, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      list = list.filter((p) => (p.age += dt) < p.life);
      for (const p of list) {
        const t = p.age / p.life;
        if (p.ember) {
          p.vx += Math.sin(p.age * p.w + p.ph) * p.sway * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          const col = tint(p.pal, 0.25 + t * 0.7), a = Math.min(1, t / 0.12) * (1 - t) * p.o;
          ctx.fillStyle = `rgba(${col},${a * 0.22})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 2.8, 0, 6.2832); ctx.fill();
          ctx.fillStyle = `rgba(${col},${a})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.2832); ctx.fill();
        } else {
          const k = Math.max(0, 1 - p.drag * dt);
          p.vx *= k; p.vy = p.vy * k + p.g * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          ctx.strokeStyle = `rgba(${tint(p.pal, t)},${1 - t * t})`;
          ctx.lineWidth = p.s * (1 - t * 0.6);
          ctx.beginPath(); ctx.moveTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045); ctx.lineTo(p.x, p.y); ctx.stroke();
        }
      }
      if (list.length) next();
      else { raf = 0; ctx.clearRect(0, 0, 1920, h); }
    };
    // A page that is not being shown gets no animation frames; a timer keeps the sparks honest there.
    const next = () => { raf = document.hidden ? -window.setTimeout(() => step(performance.now()), 33) : requestAnimationFrame(step); };
    const wake = () => { if (!raf) { last = performance.now(); next(); } };
    fx.current = {
      burst(x, y, { n = 24, speed = [260, 720], angle = -90, spread = 150, pal = HOT, g = 1500, life = [0.35, 0.9], size: sz = [1.8, 3.4], drag = 1.2 } = {}) {
        if (list.length > 700) return;
        for (let i = 0; i < n; i++) {
          const a = ((angle + rnd(-spread / 2, spread / 2)) * Math.PI) / 180, v = rnd(speed[0], speed[1]);
          list.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g, drag, pal, life: rnd(life[0], life[1]), s: rnd(sz[0], sz[1]), age: 0 });
        }
        wake();
      },
      embers(x0, x1, y, n, pal = COLD, vy = [-50, -130]) {
        if (list.length > 700) return;
        for (let i = 0; i < n; i++) {
          list.push({ ember: true, x: rnd(x0, x1), y: y + rnd(-6, 6), vx: rnd(-12, 12), vy: rnd(vy[0], vy[1]), sway: rnd(20, 60), w: rnd(1.5, 3.5), ph: rnd(0, 6),
            pal, life: rnd(1.6, 3.4), s: rnd(1.1, 2.4), o: 0.9, age: 0 });
        }
        wake();
      },
      // An element's point on the 1920 stage (fx, fy: 0..1 across it).
      pt(el, px = 0.5, py = 0.5) {
        const k = 1920 / Math.max(1, window.innerWidth), r = el.getBoundingClientRect();
        return [(r.left + r.width * px) * k, (r.top + r.height * py) * k];
      },
      later(ms, fn) { timers.push(window.setTimeout(fn, ms)); },
    };
    return () => { window.removeEventListener('resize', size); if (raf > 0) cancelAnimationFrame(raf); else window.clearTimeout(-raf); timers.forEach((t) => window.clearTimeout(t)); fx.current = null; };
  }, []);

  // A run: its score is struck, sparks fly off the well and embers follow.
  useEffect(() => {
    const was = prev.current;
    prev.current = { away, home };
    const f = fx.current;
    if (!was || !f) return;
    const up = top ? 90 : -90;
    ([['away', 0], ['home', 1]] as const).forEach(([side, i]) => {
      const runs = (side === 'away' ? away : home) - was[side];
      const well = document.querySelectorAll('.bsx .rail .team .score')[i];
      if (runs <= 0 || !well) return;
      const [x, y] = f.pt(well, 0.5, top ? 1 : 0);
      f.burst(x, y, { n: 20 + Math.min(4, runs) * 8, angle: up, spread: 120, speed: [260, 700] });
      f.later(350, () => f.embers(x - 30, x + 30, y, 6, HOT, top ? [30, 80] : [-40, -110]));
    });
  }, [away, home, top]);

  // A home run is stamped: sparks along the plate's edge as it lands, off each letter as it is struck, then embers.
  // A strikeout is cut: cold sparks off the blade.
  useEffect(() => {
    const f = fx.current;
    if (!f || !moment) return;
    if (moment === 'Home run') {
      const up = top ? 90 : -90;
      f.later(230, () => {
        const hr = document.querySelector('.bsx .hr');
        if (!hr) return;
        for (let i = 0; i < 6; i++) { const [x, y] = f.pt(hr, 0.08 + i * 0.17, top ? 0 : 1); f.burst(x, y, { n: 9, angle: up, spread: 170, speed: [200, 560], life: [0.3, 0.7] }); }
        const [x0, y] = f.pt(hr, 0.05, top ? 1 : 0), [x1] = f.pt(hr, 0.95, 0);
        for (let i = 0; i < 8; i++) f.later(500 + i * 260, () => f.embers(x0, x1, y, 5, i % 3 ? COLD : HOT, top ? [30, 70] : [-50, -130]));
      });
      document.querySelectorAll('.bsx .hr .t1 .ch').forEach((ch, i) => f.later(400 + i * 60 + 180, () => {
        const [x, y] = f.pt(ch, 0.5, 0.55);
        f.burst(x, y, { n: 7, spread: 120, speed: [220, 620], life: [0.3, 0.75], size: [1.2, 2.4] });
      }));
    } else if (moment.startsWith('Strikeout')) {
      f.later(120, () => {
        const flag = document.querySelector('.bsx .kw');
        if (!flag) return;
        const right = flag.getBoundingClientRect().left < window.innerWidth / 2 ? false : true;
        for (let i = 0; i < 3; i++) f.later(i * 110, () => {
          const [x, y] = f.pt(flag, right ? 1 - i * 0.3 : i * 0.3, 0.5);
          f.burst(x, y, { n: 22, angle: right ? 180 : 0, spread: 100, pal: COLD, g: 900, speed: [220, 640], life: [0.3, 0.7], size: [1, 2.2] });
        });
      });
    }
  }, [moment, top]);

  return <canvas ref={canvas} className="bsx-fx" aria-hidden="true" />;
}
