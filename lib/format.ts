import type { Player, PublicName } from './types.ts';

export const fullName = (p: Pick<Player, 'first_name' | 'last_name'>) =>
  `${p.first_name} ${p.last_name}`.trim();

// The same rule public_roster() applies in the database, so the Player screen
// can show exactly what the public will see before it is saved.
export function publicName(p: Pick<Player, 'first_name' | 'last_name' | 'number'>, mode: PublicName) {
  if (mode === 'full') return fullName(p) || numberOnly(p.number);
  if (mode === 'first_initial') {
    const s = `${p.first_name} ${p.last_name ? `${p.last_name[0]}.` : ''}`.trim();
    return s || numberOnly(p.number);
  }
  return numberOnly(p.number);
}
const numberOnly = (n: string) => (n ? `No. ${n}` : 'Player');

// Jersey order: numbered players by number, then the rest by name.
export function byJersey(a: Player, b: Player) {
  const na = a.number === '' ? Infinity : Number(a.number);
  const nb = b.number === '' ? Infinity : Number(b.number);
  return na - nb || fullName(a).localeCompare(fullName(b));
}

// White or near-black, whichever reads on a team colour.
export function inkOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#06090f' : '#ffffff';
}

export function shortDate(iso: string | null) {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

// "Fall 2026" in September, "Spring 2027" in February: the first season's name,
// offered as a default the organizer can change.
export function guessSeason(now = new Date()) {
  const m = now.getMonth();
  const y = now.getFullYear();
  if (m <= 5) return `Spring ${y}`;
  if (m <= 7) return `Summer ${y}`;
  return `Fall ${y}`;
}

// What goes on a scorebug for a team typed in by name (from Scoreboard's
// roster.js abbrFor, shortened to the six characters a team abbreviation holds).
export function abbrFor(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const last = words[words.length - 1];
  const pick = last.length >= 3 && last.length <= 6 ? last : words.map((w) => w[0]).join('');
  return pick.slice(0, 6).toUpperCase();
}
