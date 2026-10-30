import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractPalette, fromHex, toHex } from '../lib/palette.ts';

// A made-up logo as raw pixels: shares of each color, plus transparency.
function image(parts: [string, number][], transparent = 0) {
  const total = 10000;
  const px: number[] = [];
  for (const [hex, share] of parts) {
    const [r, g, b] = fromHex(hex);
    for (let i = 0; i < Math.round(total * share); i++) {
      // A little noise, the way anti-aliasing and JPEG leave it.
      const j = (i % 7) - 3;
      px.push(r + j, g + j, b + j, 255);
    }
  }
  for (let i = 0; i < Math.round(total * transparent); i++) px.push(255, 255, 255, 0);
  return px.map((v) => Math.max(0, Math.min(255, v)));
}

const near = (a: string, b: string, tol = 24) => {
  const x = fromHex(a), y = fromHex(b);
  return x.every((v, i) => Math.abs(v - y[i]) <= tol);
};

test('a blue and gold logo on transparency: blue primary, gold accent', () => {
  const p = extractPalette(image([['#1f3f8f', 0.55], ['#e0a92a', 0.25], ['#ffffff', 0.2]], 0.5))!;
  assert.ok(near(p.primary, '#1f3f8f'), p.primary);
  assert.ok(near(p.accent, '#e0a92a') || near(p.accent, '#ffffff'), p.accent);
  assert.ok(p.swatches.length >= 3);
});

test('a crest in two navies with gold trim is navy, with gold as the accent', () => {
  const p = extractPalette(image([['#14285c', 0.3], ['#1f3f8e', 0.22], ['#e0a92a', 0.2], ['#ffffff', 0.12], ['#81755c', 0.012], ['#b08f43', 0.012]], 0.4))!;
  assert.ok(near(p.primary, '#14285c'), p.primary);
  assert.ok(near(p.accent, '#e0a92a'), p.accent);
  // The muddy edge blends stay off the palette.
  assert.ok(!p.swatches.some((x) => near(x, '#81755c', 12)), p.swatches.join(' '));
});

test('a logo on a white square still picks its color, not the white', () => {
  const p = extractPalette(image([['#ffffff', 0.7], ['#1a7541', 0.22], ['#111111', 0.08]]))!;
  assert.ok(near(p.primary, '#1a7541'), p.primary);
  assert.ok(near(p.accent, '#ffffff') || near(p.accent, '#111111'), p.accent);
});

test('shades of one color merge into one swatch', () => {
  const p = extractPalette(image([['#2f63cc', 0.4], ['#3a6ed6', 0.3], ['#2558be', 0.3]]))!;
  assert.equal(p.swatches.length, 1);
  // With one color, the accent is a readable neutral against it.
  assert.ok(p.accent === '#f2f6fc' || p.accent === '#0b1018');
});

test('an all-black logo is black, with a light accent', () => {
  const p = extractPalette(image([['#000000', 1]]))!;
  assert.ok(near(p.primary, '#000000'));
  assert.equal(p.accent, '#f2f6fc');
});

test('nothing opaque, nothing to read', () => {
  assert.equal(extractPalette(image([], 1)), null);
});

test('hex round trip', () => {
  assert.equal(toHex(fromHex('#e0a92a')), '#e0a92a');
});
