// A team's colors, read out of its logo.
//
// The logo is drawn small (about 96 px) and every opaque pixel is dropped into
// one of 4096 buckets (4 bits per channel). The busiest buckets become
// candidate colors, and candidates too close to one already taken are merged
// away, so a gradient or an anti-aliased edge does not fill the palette with
// five shades of the same blue.
//
// The suggested primary is the color a person would call "the team color":
// common and saturated, so a logo on white or with a black outline still
// picks its blue rather than the white or the black. The accent is the next
// color that stands apart from it, which can be white, black or a second hue.

export type Rgb = [number, number, number];
export type Palette = { swatches: string[]; primary: string; accent: string };

export const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
export function fromHex(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// Lightness, chroma and hue: enough of a perceptual model to rank and to
// tell colors apart without pulling in a color library.
function lch([r, g, b]: Rgb) {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const c = max - min;
  let h = 0;
  if (c > 0) {
    const [R, G, B] = [r / 255, g / 255, b / 255];
    h = max === R ? ((G - B) / c) % 6 : max === G ? (B - R) / c + 2 : (R - G) / c + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { l, c, h };
}
// Distance that weighs how people see: a hue change at high chroma matters
// more than one between two grays.
function distance(a: Rgb, b: Rgb) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export function extractPalette(rgba: ArrayLike<number>, max = 6): Palette | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const k = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    k.n++; k.r += r; k.g += g; k.b += b;
    buckets.set(key, k);
    total++;
  }
  if (!total) return null;

  const cands = [...buckets.values()]
    .map((k) => ({ rgb: [k.r / k.n, k.g / k.n, k.b / k.n] as Rgb, share: k.n / total }))
    .filter((c) => c.share >= 0.004)
    .sort((a, b) => b.share - a.share);

  // Merge near-duplicates into the busier color they resemble.
  const taken: { rgb: Rgb; share: number }[] = [];
  for (const c of cands) {
    const near = taken.find((t) => distance(t.rgb, c.rgb) < 90);
    if (near) near.share += c.share;
    else if (taken.length < 12) taken.push({ ...c });
  }
  taken.sort((a, b) => b.share - a.share);
  // Edge pixels blend two colors (navy into gold makes a muddy olive); a
  // color that small is a blend, not a choice, and stays off the palette.
  const swatches = taken.filter((s, i) => i === 0 || s.share >= 0.02).slice(0, max);

  // Primary: common and colorful. Near-white and near-black only win when
  // the logo has nothing else.
  const score = (s: { rgb: Rgb; share: number }) => {
    const { l, c } = lch(s.rgb);
    const extreme = l > 0.9 || l < 0.08;
    return s.share * (extreme ? 0.15 : 0.35 + c * 1.6);
  };
  // A logo drawn in two shades of one color (a navy ring around a darker navy
  // field) is one color to the eye: shades of a hue add up before they are
  // weighed against a second color.
  const family = (a: Rgb, b: Rgb) => {
    const x = lch(a), y = lch(b);
    if (x.c < 0.15 || y.c < 0.15) return distance(a, b) < 90;
    const dh = Math.min(Math.abs(x.h - y.h), 360 - Math.abs(x.h - y.h));
    return dh < 22;
  };
  const weight = (s: { rgb: Rgb; share: number }) =>
    score({ rgb: s.rgb, share: swatches.filter((o) => family(o.rgb, s.rgb)).reduce((a, o) => a + o.share, 0) });
  const bestFamily = [...swatches].sort((a, b) => weight(b) - weight(a))[0];
  // Within the winning family, the shade that covers the most.
  const primary = swatches.filter((s) => family(s.rgb, bestFamily.rgb)).sort((a, b) => b.share - a.share)[0];
  // Accent: the busiest color that is clearly not the primary.
  const accent = swatches.find((s) => s !== primary && !family(s.rgb, primary.rgb) && distance(s.rgb, primary.rgb) > 160)
    ?? swatches.find((s) => s !== primary)
    ?? { rgb: (lch(primary.rgb).l > 0.5 ? [11, 16, 24] : [242, 246, 252]) as Rgb, share: 0 };

  return { swatches: swatches.map((s) => toHex(s.rgb)), primary: toHex(primary.rgb), accent: toHex(accent.rgb) };
}

// A team color behind white text needs to be dark enough to read. This is
// the slab's color; the stored primary stays exactly what the logo has.
export function readableOnWhite(hex: string) {
  const { l } = lch(fromHex(hex));
  return l <= 0.62;
}
