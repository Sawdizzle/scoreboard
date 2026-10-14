// A pasted roster, one player per line, in the shapes people actually paste
// from a group text, a lineup card or GameChanger:
//   "7 Ava Reyes SS"   "#12 Ben Ortiz (P)"   "3. Cy Park - CF"   "Finn Moore"   "21"
// A leading 1–3 digit number is the jersey; a trailing position (in brackets,
// after a dash or comma, or just last) is the spot; the rest is the name.
//
// Carried over from Scoreboard's js/roster.js (parseRosterLine). Two changes:
// the name is split into first and last, because a player's public name needs
// them apart, and DH/UT are kept, because here a position describes the
// player rather than a spot on tonight's diamond.
import { POSITIONS, type Position } from './types.ts';

export type ParsedPlayer = { number: string; first_name: string; last_name: string; positions: Position[] };

const POS_RE = new RegExp(`(?:^|[\\s(,–-])\\(?(${POSITIONS.join('|')})\\)?\\.?$`, 'i');

export function parseRosterLine(line: string): ParsedPlayer | null {
  let s = String(line || '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const positions: Position[] = [];
  const pm = s.match(POS_RE);
  if (pm && pm.index !== undefined) {
    positions.push(pm[1].toUpperCase() as Position);
    s = s.slice(0, pm.index).replace(/[\s,(–-]+$/, '').trim();
  }
  let number = '';
  const nm = s.match(/^(?:no\.?\s*)?#?(\d{1,3})(?:[.):,]|\s|$)\s*/i);
  if (nm) { number = nm[1]; s = s.slice(nm[0].length).trim(); }
  const name = s.replace(/^[-–:,.]\s*/, '').trim();
  if (!number && !name) return null;
  // "Reyes, Ava" is last-first; otherwise the first word is the first name and
  // everything after it the last ("Juan De La Cruz").
  let first = '', last = '';
  const comma = name.match(/^([^,]+),\s*(.+)$/);
  if (comma) { last = comma[1].trim(); first = comma[2].trim(); }
  else { const i = name.indexOf(' '); first = i < 0 ? name : name.slice(0, i); last = i < 0 ? '' : name.slice(i + 1).trim(); }
  return { number, first_name: first.slice(0, 40), last_name: last.slice(0, 40), positions };
}

export function parseRoster(text: string): ParsedPlayer[] {
  return String(text || '').split(/\r?\n/).map(parseRosterLine).filter((p): p is ParsedPlayer => p !== null);
}
