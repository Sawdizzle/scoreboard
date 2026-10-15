// Draws Scoreboard's app icon: a ballpark scoreboard with two lit
// seven-segment digits and a baseball over its corner. Writes the SVG and the
// PNG sizes the app needs. Run from anywhere: node scripts/app-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Seven-segment digit at (x, y), w x h, segment thickness t.
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function digit(n, x, y, w, h, t, on, off) {
  const g = 3, hh = h / 2;
  const s = {
    a: [x + t / 2 + g, y, w - t - 2 * g, t], d: [x + t / 2 + g, y + h - t, w - t - 2 * g, t], g: [x + t / 2 + g, y + hh - t / 2, w - t - 2 * g, t],
    f: [x, y + t / 2 + g, t, hh - t - g], b: [x + w - t, y + t / 2 + g, t, hh - t - g],
    e: [x, y + hh + g, t, hh - t / 2 - 2 * g], c: [x + w - t, y + hh + g, t, hh - t / 2 - 2 * g],
  };
  return Object.entries(s).map(([k, [sx, sy, sw, sh]]) =>
    `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="${t / 2}" fill="${SEG[n].includes(k) ? on : off}"/>`).join('');
}

function icon({ pad = 0, bg = true } = {}) {
  const beams = `      <!-- light from the top -->
      <path d="M150 -20 L230 -20 L330 300 L40 300 Z" fill="url(#beam)" opacity=".32"/>
      <path d="M282 -20 L362 -20 L472 300 L182 300 Z" fill="url(#beam)" opacity=".2"/>
`;
  // Everything is drawn on a 512 frame; pad shrinks the art toward the middle (maskable safe zone).
  const k = (512 - 2 * pad) / 512;
  const art = `
${beams.replace(/^ {6}/gm, '    ')}    <g transform="translate(${pad} ${pad}) scale(${k})">
      <!-- the board -->
      <rect x="44" y="168" width="424" height="262" rx="40" fill="url(#plate)" stroke="#f2b632" stroke-width="12"/>
      <rect x="62" y="186" width="388" height="226" rx="28" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="3"/>
      <rect x="252" y="214" width="8" height="170" rx="4" fill="rgba(255,255,255,.12)"/>
      <!-- the scores, lit -->
      <g filter="url(#glow)">
        ${digit(4, 104, 214, 110, 170, 26, '#ffcf3a', 'rgba(255,207,58,.08)')}
        ${digit(2, 298, 214, 110, 170, 26, '#ffcf3a', 'rgba(255,207,58,.08)')}
      </g>
      <!-- the ball over the corner -->
      <g filter="url(#shadow)" transform="translate(14 -20) scale(.94)" transform-origin="404 146">
        <circle cx="404" cy="146" r="86" fill="url(#ball)"/>
        <path d="M352 78 Q392 146 352 214" fill="none" stroke="#d63c33" stroke-width="9" stroke-linecap="round"/>
        <path d="M456 78 Q416 146 456 214" fill="none" stroke="#d63c33" stroke-width="9" stroke-linecap="round"/>
        ${[0, 1, 2, 3, 4].map((i) => {
          const t = 0.18 + i * 0.16, y = 78 + 136 * t;
          const xl = 352 + 2 * (1 - t) * t * 40 + 0, xr = 456 - 2 * (1 - t) * t * 40;
          return `<path d="M${xl - 9} ${y - 6} L${xl + 9} ${y + 2}" stroke="#d63c33" stroke-width="5" stroke-linecap="round"/><path d="M${xr + 9} ${y - 6} L${xr - 9} ${y + 2}" stroke="#d63c33" stroke-width="5" stroke-linecap="round"/>`;
        }).join('')}
      </g>
    </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="sky" cx="50%" cy="10%" r="95%"><stop offset="0" stop-color="#22355c"/><stop offset=".55" stop-color="#0e1729"/><stop offset="1" stop-color="#060a13"/></radialGradient>
    <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff6dc" stop-opacity=".55"/><stop offset="1" stop-color="#fff6dc" stop-opacity="0"/></linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2740"/><stop offset="1" stop-color="#070b14"/></linearGradient>
    <radialGradient id="ball" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#eef2f7"/><stop offset="1" stop-color="#b9c3d1"/></radialGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".55"/></filter>
  </defs>
  ${bg ? '<rect width="512" height="512" fill="url(#sky)"/>' : ''}
  ${art}
</svg>`;
}

const full = icon();
const safe = icon({ pad: 56 });
fs.writeFileSync(path.join(root, 'app/icon.svg'), full);
const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 72 * (size / 512) * 2 }).resize(size, size).png().toFile(file);
await png(full, 180, path.join(root, 'app/apple-icon.png'));
await png(full, 192, path.join(root, 'public/icon-192.png'));
await png(full, 512, path.join(root, 'public/icon-512.png'));
await png(safe, 512, path.join(root, 'public/icon-maskable-512.png'));
console.log('done');
