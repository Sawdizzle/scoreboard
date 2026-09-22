// Weather on the Game paused card: storm clouds, rain, and lightning.
//
// The motion that never stops (clouds drifting, rain falling) animates
// transform only, so it stays compositor work: the pause card can sit in an OBS
// browser source for half an hour. Strikes are brief and may repaint.
//
// Flashes are kept inside the photosensitive-safe limit: never more than two
// flashes in any one second, and the full-frame wash never goes above ~0.5
// opacity. Children watch these streams.

const SVGNS = 'http://www.w3.org/2000/svg';
const W = 1920, H = 1080;

// What each reason looks like. Suspended and Called get the clouds only: the
// weather has already made its decision.
const LOOK = {
  lightning: { clouds: 'dark', rain: 'light', bolts: true },
  rain:      { clouds: 'grey', rain: 'heavy', bolts: false },
  weather:   { clouds: 'dark', rain: 'light', bolts: false, distant: true },
  suspended: { clouds: 'grey', rain: null, bolts: false },
  called:    { clouds: 'grey', rain: null, bolts: false },
};

let kind = null;
let ambientTimer = null;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

function build(layer, k) {
  const look = LOOK[k];
  const root = el('div', `storm storm-${k} clouds-${look.clouds}`);
  root.setAttribute('aria-hidden', 'true');
  // Three cloud banks drifting at different speeds give the sky some depth.
  for (let i = 0; i < 3; i++) root.appendChild(el('div', `st-cloud c${i}`));
  if (look.rain) {
    // Two sheets of rain, near and far, each twice the frame tall so a
    // translateY loop never shows an edge.
    root.appendChild(el('div', `st-rain far ${look.rain}`));
    root.appendChild(el('div', `st-rain near ${look.rain}`));
  }
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'st-bolts');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  root.appendChild(svg);
  layer.prepend(root);
  return root;
}

// The full-frame flash sits above everything, the ticker included, so the
// whole picture lights up the way a real strike does.
const flashEl = () => document.getElementById('storm-flash');

// Call on every render. `k` is the pause reason, or null when no pause card is up.
export function setStorm(layer, k) {
  const want = k && LOOK[k] ? k : null;
  let root = layer.querySelector(':scope > .storm');
  // A card remount rewrites the layer's innerHTML and takes the storm with it.
  if (want && (!root || want !== kind)) {
    if (root) root.remove();
    root = build(layer, want);
  } else if (!want && root) root.remove();
  if (want !== kind) {
    kind = want;
    clearTimeout(ambientTimer);
    if (kind && (LOOK[kind].bolts || LOOK[kind].distant)) scheduleAmbient();
  }
}

function scheduleAmbient() {
  clearTimeout(ambientTimer);
  const look = LOOK[kind];
  // Lightning: a strike every 5–12 s. Weather delay: a far-off glow every 12–25 s.
  const wait = look.bolts ? 5000 + Math.random() * 7000 : 12000 + Math.random() * 13000;
  ambientTimer = setTimeout(() => {
    if (!kind) return;
    if (!reduced()) {
      if (LOOK[kind].bolts) strike(false);
      else glow();
    }
    scheduleAmbient();
  }, wait);
}

// A jagged bolt from the top of the frame: midpoint displacement, then a
// couple of forks peeling off the trunk.
function boltPath(x0, y0, x1, y1, rough, depth) {
  let pts = [[x0, y0], [x1, y1]];
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      next.push([(ax + bx) / 2 + (Math.random() - 0.5) * len * rough, (ay + by) / 2 + (Math.random() - 0.5) * len * rough * 0.25], [bx, by]);
    }
    pts = next;
  }
  return pts;
}
const toD = (pts) => 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');

function drawBolt(svg, big) {
  // Ambient strikes keep to the sides, clear of the headline and the clock;
  // the big one (a new strike, from the pad) can land anywhere.
  const side = Math.random() < 0.5;
  const x0 = big ? 300 + Math.random() * 1320 : (side ? 80 + Math.random() * 380 : 1460 + Math.random() * 380);
  const y1 = (big ? 0.75 : 0.45) * H + Math.random() * 0.2 * H;
  const x1 = x0 + (Math.random() - 0.5) * 360;
  const trunk = boltPath(x0, -20, x1, y1, 0.55, 6);
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', `st-bolt${big ? ' big' : ''}`);
  const paths = [toD(trunk)];
  const forks = 1 + Math.floor(Math.random() * (big ? 3 : 2));
  for (let i = 0; i < forks; i++) {
    const at = trunk[Math.floor(trunk.length * (0.25 + Math.random() * 0.45))];
    const dir = Math.random() < 0.5 ? -1 : 1;
    paths.push(toD(boltPath(at[0], at[1], at[0] + dir * (120 + Math.random() * 260), at[1] + 140 + Math.random() * 220, 0.6, 4)));
  }
  paths.forEach((d, i) => {
    // Glow underneath, a bright core on top. Forks are thinner.
    for (const cls of ['glow', 'core']) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', `${cls}${i ? ' fork' : ''}`);
      g.appendChild(p);
    }
  });
  svg.appendChild(g);
  // Draw in fast, flicker once, fade. Two bright moments in ~0.4 s.
  const cores = g.querySelectorAll('path');
  cores.forEach((p) => {
    const len = p.getTotalLength ? p.getTotalLength() : 2000;
    p.style.strokeDasharray = `${len}`;
    p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: big ? 140 : 110, easing: 'ease-in', fill: 'forwards' });
  });
  const a = g.animate(
    [{ opacity: 1 }, { opacity: 1, offset: 0.25 }, { opacity: 0.25, offset: 0.35 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }],
    { duration: big ? 1100 : 800, easing: 'ease-out', fill: 'forwards' });
  a.onfinish = () => g.remove();
}

function wash(peak, twice) {
  const f = flashEl();
  if (!f) return;
  const frames = twice
    ? [{ opacity: 0 }, { opacity: peak, offset: 0.08 }, { opacity: 0.08, offset: 0.3 }, { opacity: peak * 0.85, offset: 0.42 }, { opacity: 0 }]
    : [{ opacity: 0 }, { opacity: peak, offset: 0.1 }, { opacity: 0 }];
  f.animate(frames, { duration: twice ? 900 : 600, easing: 'ease-out' });
}

// The card itself reacts: the headline catches the light, and on a big strike
// the countdown jolts.
function lightCard(big) {
  const card = document.querySelector('#card .card.pz');
  if (!card) return;
  const title = card.querySelector('.pz-title');
  if (title) title.animate([{ textShadow: '0 0 0 transparent' }, { textShadow: '0 0 38px rgba(210, 225, 255, 0.95)', offset: 0.15 }, { textShadow: '0 0 0 transparent' }], { duration: 900 });
  const clock = big && card.querySelector('.pz-clock');
  if (clock) clock.animate([{ transform: 'none' }, { transform: 'translate(-6px, 2px)' }, { transform: 'translate(5px, -2px)' }, { transform: 'translate(-3px, 1px)' }, { transform: 'none' }], { duration: 380, easing: 'ease-out' });
}

// One strike. `big` is the operator's "new strike" (Restart 30) or the pause
// going up: a bigger bolt, a double flash, and the countdown jolting.
export function strike(big = false) {
  const svg = document.querySelector('#card > .storm .st-bolts');
  if (!svg || reduced()) return;
  drawBolt(svg, big);
  wash(big ? 0.5 : 0.32, big || Math.random() < 0.4);
  lightCard(big);
}

// Weather delay: no bolt, just the clouds lighting from inside, far away.
function glow() {
  const root = document.querySelector('#card > .storm');
  if (!root) return;
  const c = root.querySelector(`.st-cloud.c${Math.floor(Math.random() * 3)}`);
  if (c) c.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(2.2)', offset: 0.12 }, { filter: 'brightness(1.2)', offset: 0.3 }, { filter: 'brightness(1.8)', offset: 0.4 }, { filter: 'brightness(1)' }], { duration: 1400 });
  wash(0.12, false);
}
