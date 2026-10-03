// What the stream says about the people in the game: the batter's line for
// the scorebug, and the batter, pitcher and due-up cards. One place works it
// out, from the game as the rules see it plus tonight's and the season's
// counts, so the pad's On Air panel and the scorebug page cannot disagree.
import * as L from './rules/logic.js';
import { positionOf } from './rules/roster.js';
import { engineGame, tonight, type EngineSide, type G, type StatKey } from './scoring.ts';
import { batting, innings, pitching, rate2, rate3, type SeasonLine } from './stats.ts';
import type { Game, Lineup, Side } from './types.ts';

export type CardKind = 'batter' | 'pitcher' | 'dueup';
export type Line = Partial<Record<StatKey, number>>;
export type Pa = { side: Side; bid: string; inning: number | null; kind: string; code: string | null };
export type FeedTeam = { name: string; display_name: string; color: string; color2: string; logo_url: string | null; age_group: string | null };

// overlay_feed(), as it arrives. With no game to show, `game` is null and the
// rest is absent.
export type Feed = {
  v: string;
  show_line: boolean; auto_card: boolean; card: CardKind | null;
  team: FeedTeam; opponent: FeedTeam;
  game: (Pick<Game, 'id' | 'is_home' | 'status' | 'live'> & { seq: number }) | null;
  season: { name: string; game_innings: number } | null;
  lineups: { us: Lineup | null; them: Lineup | null };
  tonight: (Line & { side: Side; bid: string })[];
  pas: Pa[];
  season_stats: SeasonLine[];
};

export type Cell = { v: string; k: string };
export type BatterView = {
  bid: string; num: string; name: string; pos: string;
  // Season average, or null when there is no season behind this player.
  avg: string | null;
  today: string;
  games: number | null;
  cells: Cell[];
  pas: { inn: string; what: string }[];
};
export type PitcherView = {
  bid: string; num: string; name: string; last: string;
  // The count the scorebug shows: the rules' own, which survives a correction.
  pitches: number;
  today: Cell[];
  season: Cell[] | null;
};
export type AirView = {
  batSide: EngineSide; fieldSide: EngineSide;
  batter: BatterView | null; pitcher: PitcherView | null; dueUp: BatterView[];
};
export type AirCtx = {
  tonight: Record<string, Line>;
  season: Record<string, SeasonLine>;
  pas: Pa[];
  gameInnings: number;
};

const ORD = ['', '1st', '2nd', '3rd'];
export const ordinal = (n: number) => ORD[n] ?? `${n}th`;

// What a plate appearance is called on a card: short, and with the scorebook
// code where there is one ("Flyout F8").
const SHORT: Record<string, string> = { K: 'Strikeout', KL: 'K looking', K3: 'Dropped 3rd', E: 'Error', IBB: 'Int. walk', CI: 'Interference', OUT: 'Out' };
const CODED = new Set(['GB', 'FB', 'LD', 'PU', 'DP', 'SF', 'SAC', 'E', 'FC']);
export function paText(pa: Pick<Pa, 'kind' | 'code'>) {
  const label = SHORT[pa.kind] ?? (L.PLAY_LABEL as Record<string, string>)[pa.kind] ?? pa.kind;
  return pa.code && CODED.has(pa.kind) ? `${label} ${pa.code}` : label;
}

const known = (b: { num?: string; name?: string } | undefined) => !!b && !!(b.num || b.name);

function batterView(lineup: Lineup | undefined, idx: number, ctx: AirCtx): BatterView | null {
  const b = lineup?.batters?.[idx];
  if (!lineup || !b || !known(b)) return null;
  const s = ctx.season[b.bid];
  const has = !!s && s.b_pa > 0;
  const r = has ? batting(s) : null;
  return {
    bid: b.bid, num: b.num, name: b.name || (b.num ? `#${b.num}` : ''), pos: positionOf(lineup, idx) || '',
    avg: r ? rate3(r.avg) : null,
    today: tonight(ctx.tonight[b.bid]),
    games: has ? s.b_g : null,
    cells: r ? [{ v: rate3(r.obp), k: 'OBP' }, { v: String(s.b_hr), k: 'HR' }, { v: String(s.b_rbi), k: 'RBI' }, { v: String(s.b_sb), k: 'SB' }] : [],
    pas: ctx.pas.filter((p) => p.bid === b.bid).map((p) => ({ inn: p.inning ? ordinal(p.inning) : '', what: paText(p) })),
  };
}

export function airView(g: G, ctx: AirCtx): AirView {
  const batSide = L.battingSide(g) as EngineSide, fieldSide = L.fieldingSide(g) as EngineSide;
  const bat = g.lineups[batSide], field = g.lineups[fieldSide];
  const idx = L.currentBatterIdx(g, batSide);
  const n = bat?.batters?.length ?? 0;
  // The hitter at the plate and the two behind him, around the order.
  const dueUp = n ? [0, 1, 2].slice(0, Math.min(3, n)).map((d) => batterView(bat, (idx + d) % n, ctx)).filter((b): b is BatterView => !!b) : [];

  const pBid = field?.positions?.P;
  const p = pBid ? field?.batters?.find((b) => b.bid === pBid) : undefined;
  let pitcher: PitcherView | null = null;
  if (p && known(p)) {
    const t = ctx.tonight[p.bid] ?? {};
    const s = ctx.season[p.bid];
    const has = !!s && (s.p_outs > 0 || s.p_bf > 0);
    const r = has ? pitching(s, ctx.gameInnings) : null;
    const name = p.name || `#${p.num}`;
    pitcher = {
      bid: p.bid, num: p.num, name, last: p.name ? p.name.trim().split(/\s+/).pop() ?? name : name,
      pitches: L.pitchCount(g),
      today: [{ v: innings(t.p_outs ?? 0), k: 'IP' }, { v: String(t.p_r ?? 0), k: 'R' }, { v: String(t.p_so ?? 0), k: 'K' }, { v: String(t.p_pitches ?? 0), k: 'P' }],
      season: r ? [{ v: rate2(r.era), k: 'ERA' }, { v: String(s.p_so), k: 'K' }, { v: rate2(r.whip), k: 'WHIP' }] : null,
    };
  }
  return { batSide, fieldSide, batter: batterView(bat, idx, ctx), pitcher, dueUp };
}

// The feed, ready to draw: the game as the rules see it, and the view of it.
export function feedView(feed: Feed) {
  if (!feed.game) return null;
  const gameInnings = feed.season?.game_innings ?? 7;
  const g = engineGame(feed.game, { us: feed.lineups.us ?? undefined, them: feed.lineups.them ?? undefined }, gameInnings);
  const ctx: AirCtx = {
    tonight: Object.fromEntries(feed.tonight.map((r) => [r.bid, r])),
    season: Object.fromEntries(feed.season_stats.map((s) => [s.player_id, s])),
    pas: feed.pas, gameInnings,
  };
  return { g, air: airView(g, ctx) };
}
