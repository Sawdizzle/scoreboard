// Lineups on top of Scoreboard's roster rules (lib/rules/roster.js), which own
// positions and ids: this file only builds lineups from a roster and checks
// what the pad will need.
import { FIELD_POSITIONS, filled, missingPositions, normalizeTeam } from './rules/roster.js';
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
