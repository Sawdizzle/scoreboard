// Lineups on top of Scoreboard's roster rules (lib/rules/roster.js), which own
// positions and ids: this file only builds lineups from a roster and checks
// what the pad will need.
import { FIELD_POSITIONS, filled, missingPositions, normalizeTeam, setPosition } from './rules/roster.js';
import { byJersey, formatName } from './format.ts';
import type { Lineup, LineupBatter, NameFormat, Player } from './types.ts';

export const FIELD = FIELD_POSITIONS as readonly string[];

export const batterOf = (p: Pick<Player, 'id' | 'number' | 'first_name' | 'last_name'>, fmt: NameFormat = 'full'): LineupBatter =>
  ({ bid: p.id, num: p.number, name: formatName(p, fmt) });

export const emptyLineup = (): Lineup => ({ batters: [], positions: {} });

// Everyone active, in jersey order, each put at the first position listed for
// them that nobody earlier has taken. A start the coach rearranges, not a guess
// that pretends to be a decision.
export function lineupFromRoster(players: Player[], fmt: NameFormat = 'full'): Lineup {
  const active = players.filter((p) => p.active).sort(byJersey);
  const positions: Record<string, string> = {};
  for (const p of active) {
    const pos = p.positions.find((x) => FIELD.includes(x) && !positions[x]);
    if (pos) positions[pos] = p.id;
  }
  return normalizeTeam({ batters: active.map((p) => batterOf(p, fmt)), positions }) as Lineup;
}

// Last game's lineup, minus anyone no longer on the active roster, with names
// and numbers refreshed from the roster.
export function lineupFromLast(last: Lineup, players: Player[], fmt: NameFormat = 'full'): Lineup {
  const live = new Map(players.filter((p) => p.active).map((p) => [p.id, p]));
  const batters = (last.batters || []).filter((b) => live.has(b.bid)).map((b) => batterOf(live.get(b.bid)!, fmt));
  const keep = new Set(batters.map((b) => b.bid));
  const positions = Object.fromEntries(Object.entries(last.positions || {}).filter(([, bid]) => keep.has(bid)));
  return normalizeTeam({ batters, positions }) as Lineup;
}

// A saved lineup with each roster player's name and number as the roster has
// them now, in the team's format: a lineup keeps the names it was saved with,
// and the format may have changed since. A batter typed in at the field (not
// on the roster) keeps what was typed.
export function withRosterNames(l: Lineup, players: Player[], fmt: NameFormat = 'full'): Lineup {
  const by = new Map(players.map((p) => [p.id, p]));
  const batters = (l.batters || []).map((b) => { const p = by.get(b.bid); return p ? batterOf(p, fmt) : b; });
  // normalizeTeam refreshes the pitcher's copy from positions.P as well.
  return normalizeTeam({ ...l, batters }) as Lineup;
}

// What the setup checklist and the Today card say about a lineup.
export function lineupStatus(l: Lineup | undefined) {
  if (!l) return { batters: 0, missing: [...FIELD] as string[], ready: false };
  const batters = (l.batters || []).filter(filled).length;
  const missing = missingPositions(l) as string[];
  return { batters, missing, ready: batters >= 9 && missing.length === 0 };
}

// ---- From the card ---------------------------------------------------------
// The lineup card handed over at game time, typed in batting order: one jersey
// number at a time, each optionally with where that kid plays. `cursor` is the
// slot the next number goes to; everyone above it came off the card already.
//
// A number already in the order below the cursor moves up to it, so "same as
// last game" can be re-ordered by typing the card, never doubled. A number on
// the bench joins at the cursor. A number above the cursor is already placed.
// Anything else is a new kid: the editor asks who, then calls placeBatter.
// `pos`: undefined keeps the player's spot, '' takes them out of the field
// (an extra hitter), a field position puts them there.
export type CardStep =
  | { ok: true; team: Lineup; at: number }
  | { ok: false; why: 'placed'; at: number }
  | { ok: false; why: 'unknown' };

export function placeBatter(team: Lineup, cursor: number, b: LineupBatter, pos?: string): Lineup {
  const t = normalizeTeam(team) as Lineup;
  const batters = t.batters.filter((x) => x.bid !== b.bid);
  const at = Math.min(Math.max(cursor, 0), batters.length);
  batters.splice(at, 0, b);
  const placed = normalizeTeam({ ...t, batters }) as Lineup;
  return pos === undefined ? placed : setPosition(placed, at, pos).team as Lineup;
}

export function placeFromCard(team: Lineup, cursor: number, num: string, bench: LineupBatter[], pos?: string): CardStep {
  const t = normalizeTeam(team) as Lineup;
  const n = num.replace(/\D/g, '').slice(0, 3);
  const j = n ? t.batters.findIndex((b) => b.num === n) : -1;
  if (j >= 0 && j < cursor) return { ok: false, why: 'placed', at: j };
  const at = Math.min(cursor, t.batters.length);
  if (j >= 0) return { ok: true, team: placeBatter(t, at, t.batters[j], pos), at };
  const off = bench.find((b) => b.num === n && !t.batters.some((x) => x.bid === b.bid));
  if (off) return { ok: true, team: placeBatter(t, at, { bid: off.bid, num: off.num, name: off.name }, pos), at };
  return { ok: false, why: 'unknown' };
}

// Done with the card: whoever was not on it (below the cursor) goes to the
// bench, and their spots in the field with them.
export function benchFrom(team: Lineup, cursor: number): Lineup {
  const t = normalizeTeam(team) as Lineup;
  const keep = t.batters.slice(0, Math.max(cursor, 0));
  const ids = new Set(keep.map((b) => b.bid));
  const positions = Object.fromEntries(Object.entries(t.positions).filter(([, bid]) => ids.has(bid)));
  return normalizeTeam({ batters: keep, positions }) as Lineup;
}

// A lineup that came back from the browser, rebuilt from what is allowed in
// one: no unknown keys, no position pointing at nobody, sizes capped.
export function cleanLineup(raw: unknown): Lineup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { batters?: unknown; positions?: unknown };
  if (!Array.isArray(r.batters) || r.batters.length > 40) return null;
  const batters: LineupBatter[] = [];
  for (const b of r.batters) {
    if (!b || typeof b !== 'object') return null;
    const { bid, num, name } = b as Record<string, unknown>;
    if (typeof bid !== 'string' || !/^[\w-]{1,64}$/.test(bid)) return null;
    const n = typeof num === 'string' ? num.trim() : '';
    if (!/^\d{0,3}$/.test(n)) return null;
    batters.push({ bid, num: n, name: typeof name === 'string' ? name.trim().slice(0, 60) : '' });
  }
  if (new Set(batters.map((b) => b.bid)).size !== batters.length) return null;
  const ids = new Set(batters.map((b) => b.bid));
  const positions: Record<string, string> = {};
  if (r.positions && typeof r.positions === 'object') {
    for (const [pos, bid] of Object.entries(r.positions as Record<string, unknown>)) {
      // One spot per player: a second claim on the same player is dropped.
      if (FIELD.includes(pos) && typeof bid === 'string' && ids.has(bid) && !Object.values(positions).includes(bid)) positions[pos] = bid;
    }
  }
  return normalizeTeam({ batters, positions }) as Lineup;
}
