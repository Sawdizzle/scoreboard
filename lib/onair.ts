// What the stream says about the people in the game: the batter's line for
// the scorebug, and the batter, pitcher and due-up cards. One place works it
// out, from the game as the rules see it plus tonight's and the season's
// counts, so the pad's On Air panel and the scorebug page cannot disagree.
import * as L from './rules/logic.js';
import { positionOf } from './rules/roster.js';
import { engineGame, tonight, type EngineSide, type G, type StatKey } from './scoring.ts';
import { batting, innings, pitching, rate2, rate3, type SeasonLine } from './stats.ts';
import { sitFor, type Sport, type SportLive } from './sports.ts';
import type { Game, Lineup, Side } from './types.ts';

export type CardKind = 'batter' | 'pitcher' | 'dueup' | 'leaders' | 'box' | 'lineup' | 'defense' | 'matchup' | 'sponsor' | 'mid';

// How the scorebug looks: Pressbox's own, or one of Scoreboard's animated
// bugs (public/bugs/<slug>.html), which draw the game themselves.
export const LOOKS = [
  ['pressbox', 'Pressbox'], ['primetime', 'Prime Time'], ['bluesteel', 'Blue Steel'], ['forever20', 'Forever 20'], ['midnight', 'Midnight'],
  ['classic-green', 'Classic Green'], ['pinball-dmd', 'Pinball'], ['chalkboard', 'Chalkboard'], ['comic', 'Comic'],
  ['split-flap', 'Split Flap'], ['receipt', 'Receipt'], ['pixel-rpg', 'Pixel RPG'],
] as const;
export type Look = (typeof LOOKS)[number][0];
export type Line = Partial<Record<StatKey, number>>;
export type Pa = { side: Side; bid: string; inning: number | null; kind: string; code: string | null };
export type FeedTeam = { name: string; display_name: string; abbr?: string; color: string; color2: string; logo_url: string | null; age_group: string | null };

// overlay_feed(), as it arrives. With no game to show, `game` is null and the
// rest is absent.
export type Feed = {
  v: string;
  show_line: boolean; auto_card: boolean; card: CardKind | null; look?: Look;
  // The play that made the game what it is now; null after an undo.
  last?: { seq: number; type: string; kind: string | null; rolled?: boolean } | null;
  // Put the mid-inning board up by itself between halves.
  auto_mid?: boolean;
  sponsor?: { name: string; line: string | null; logo: string | null } | null;
  roster?: { id: string; num: string; name: string }[];
  team: FeedTeam; opponent: FeedTeam;
  game: (Pick<Game, 'id' | 'is_home' | 'status' | 'live'> & { seq: number; sport?: Sport }) | null;
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
  // The batting side's whole order, and the fielding side by position.
  order: BatterView[];
  defense: { pos: string; num: string; name: string }[];
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

const FIELD = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'];
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
  const order = Array.from({ length: n }, (_, i) => batterView(bat, i, ctx)).filter((b): b is BatterView => !!b);
  const defense = FIELD.map((pos) => {
    const b = field?.batters?.find((x) => x.bid === field?.positions?.[pos]);
    return b && known(b) ? { pos, num: b.num, name: b.name || `#${b.num}` } : null;
  }).filter((d): d is { pos: string; num: string; name: string } => !!d);
  return { batSide, fieldSide, batter: batterView(bat, idx, ctx), pitcher, dueUp, order, defense };
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

// ---- Team leaders ---------------------------------------------------------
export type Leader = { k: string; v: string; num: string; name: string };
// The season's best in each column, ours only. A batting average needs at-bats
// behind it: ten, or half the team's most when the season is young.
export function leaders(lines: SeasonLine[], roster: { id: string; num: string; name: string }[]): Leader[] {
  const who = new Map(roster.map((r) => [r.id, r]));
  const mine = lines.filter((l) => who.has(l.player_id) && l.b_pa > 0);
  const need = Math.min(10, Math.ceil(Math.max(0, ...mine.map((l) => l.b_ab)) / 2));
  const top = (k: string, of: SeasonLine[], val: (l: SeasonLine) => number, show: (n: number) => string): Leader | null => {
    const best = of.reduce<SeasonLine | null>((a, l) => (val(l) > (a ? val(a) : 0) ? l : a), null);
    if (!best) return null;
    const r = who.get(best.player_id)!;
    return { k, v: show(val(best)), num: r.num, name: r.name || `#${r.num}` };
  };
  return [
    top('AVG', mine.filter((l) => l.b_ab > 0 && l.b_ab >= need), (l) => batting(l).avg ?? 0, (n) => rate3(n)),
    top('HR', mine, (l) => l.b_hr, String), top('RBI', mine, (l) => l.b_rbi, String), top('SB', mine, (l) => l.b_sb, String),
  ].filter((x): x is Leader => !!x);
}

// ---- The box score ----------------------------------------------------------
// Runs by inning for both sides, the last nine when a game runs long, with a
// dash for a half not yet played.
export function boxScore(g: G, innings: number) {
  const ls = (Array.isArray(g.line_score) ? g.line_score : []) as { top?: number; bottom?: number }[];
  const n = Math.max(innings, g.inning | 0, ls.length);
  const from = Math.max(0, n - 9);
  const played = (i: number, half: 'top' | 'bottom') =>
    i + 1 < g.inning || (i + 1 === g.inning && (half === 'top' || g.half === 'bottom')) || g.status === 'final' && i < ls.length;
  const row = (half: 'top' | 'bottom') => Array.from({ length: n - from }, (_, j) => {
    const i = from + j;
    return played(i, half) ? String(ls[i]?.[half] ?? 0) : '';
  });
  const tot = (side: EngineSide) => [g[`${side}_score`], g[`${side}_hits`], g[`${side}_errors`]].map((x) => String(Number(x) || 0));
  return { innings: Array.from({ length: n - from }, (_, j) => from + j + 1), away: row('top'), home: row('bottom'), awayTot: tot('away'), homeTot: tot('home') };
}

// ---- Scoreboard's animated bugs ---------------------------------------------
// The game in the shape bugs/kit.js takes ("scoreboard:live").
export function bugState(feed: Feed, g: G, air: AirView) {
  const us = feed.team, them = feed.opponent;
  const of = (side: EngineSide) => ((side === 'home') === feed.game!.is_home ? us : them);
  const team = (side: EngineSide) => {
    const t = of(side);
    return {
      name: t.display_name || t.name, abbr: (t.abbr || t.display_name || t.name).toUpperCase(), color: t.color,
      r: Number(g[`${side}_score`]) || 0, h: Number(g[`${side}_hits`]) || 0, e: Number(g[`${side}_errors`]) || 0, line: [],
      k: L.strikeoutsFor(g, side),
    };
  };
  const b = L.safeBases(g.bases);
  const sport = feed.game!.sport ?? 'baseball';
  return {
    away: team('away'), home: team('home'),
    inning: g.inning | 0 || 1, half: g.half === 'bottom' ? 'bot' : 'top',
    balls: g.balls | 0, strikes: g.strikes | 0, outs: g.outs | 0,
    bases: [b.first, b.second, b.third],
    // These bugs have one line for the batter: his average rides on it when the season line is on.
    batter: air.batter ? air.batter.name + (feed.show_line && air.batter.avg ? ` · ${air.batter.avg}` : '') : '',
    pitcher: air.pitcher?.name ?? '', pitchCount: air.pitcher ? air.pitcher.pitches : 0,
    sport, sit: sport === 'baseball' ? null : sitFor(sport, feed.game!.live as SportLive),
  };
}
// The stinger a play earns on an animated bug, in the kit's terms. Anything
// not listed is read off the game row by the kit itself.
export function bugAnim(last: Feed['last']) {
  if (!last) return null;
  if (last.type === 'homerun') return { type: 'homerun', meta: {} };
  if (last.type === 'strikeout') return { type: last.kind === 'KL' ? 'strikeoutlooking' : 'strikeout', meta: {} };
  if (last.kind === 'DP') return { type: 'doubleplay', meta: {} };
  const text = last.kind ? (L.PLAY_LABEL as Record<string, string>)[last.kind] : '';
  return last.type === 'play' && text ? { type: 'play', meta: { text } } : null;
}

// The words for a play worth a moment on Pressbox's own bug, or null.
const MOMENTS: Record<string, string> = { H1: 'Single', H2: 'Double', H3: 'Triple', DP: 'Double play', SB: 'Stolen base', SF: 'Sac fly' };
export function momentText(last: Feed['last']) {
  if (!last) return null;
  if (last.type === 'homerun') return 'Home run';
  if (last.type === 'strikeout') return last.kind === 'KL' ? 'Strikeout looking' : 'Strikeout';
  return (last.kind && MOMENTS[last.kind]) || null;
}

// "Middle of the 5th" after the top, "End of the 5th" after the bottom.
export function breakText(g: G) {
  return g.half === 'bottom' ? `Middle of the ${ordinal(g.inning | 0)}` : `End of the ${ordinal(Math.max(1, (g.inning | 0) - 1))}`;
}
