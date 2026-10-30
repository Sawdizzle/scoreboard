import type { NameFormat, Player, PublicName } from './types.ts';

export const fullName = (p: Pick<Player, 'first_name' | 'last_name'>) =>
  `${p.first_name} ${p.last_name}`.trim();

// A name in the team's format (teams.name_format), the same rule as the
// database's format_name(). A missing part falls back to the part there is.
export function formatName(p: Pick<Player, 'first_name' | 'last_name'>, fmt: NameFormat = 'full') {
  const f = (p.first_name ?? '').trim(), l = (p.last_name ?? '').trim();
  const initial = (s: string) => Array.from(s)[0];
  switch (fmt) {
    case 'initial_last': return f && l ? `${initial(f)}. ${l}` : `${f} ${l}`.trim();
    case 'last': return l || f;
    case 'first': return f || l;
    case 'first_initial': return `${f} ${l ? `${initial(l)}.` : ''}`.trim();
    default: return `${f} ${l}`.trim();
  }
}

// A roster player as staff screens name them: the team format, or the number.
export const staffName = (p: Pick<Player, 'first_name' | 'last_name' | 'number'>, fmt: NameFormat = 'full') =>
  formatName(p, fmt) || numberOnly(p.number);

// The same rule player_public_name() applies in the database, so the Player
// screen can show exactly what the public will see before it is saved: the
// team format, capped by the player's own setting.
export function publicName(p: Pick<Player, 'first_name' | 'last_name' | 'number'>, mode: PublicName, fmt: NameFormat = 'full') {
  if (mode === 'number') return numberOnly(p.number);
  const shown = mode === 'first_initial' && fmt !== 'first' ? 'first_initial' : fmt;
  return formatName(p, shown) || numberOnly(p.number);
}
const numberOnly = (n: string) => (n ? `No. ${n}` : 'Player');

// The one word a tight spot has room for: the surname, as a name in any team
// format ends in it. "Alex R." ends in an initial, so it stays whole.
export function shortName(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const last = words.at(-1) ?? '';
  return /^\p{L}\.$/u.test(last) ? words.join(' ') : last;
}

// Jersey order: numbered players by number, then the rest by name.
export function byJersey(a: Player, b: Player) {
  const na = a.number === '' ? Infinity : Number(a.number);
  const nb = b.number === '' ? Infinity : Number(b.number);
  return na - nb || fullName(a).localeCompare(fullName(b));
}

// White or near-black, whichever reads on a team color.
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
