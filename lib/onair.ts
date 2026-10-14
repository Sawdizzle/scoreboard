// What the stream says about the people in the game: the batter's line for
// the scorebug, and the batter, pitcher and due-up cards. One place works it
// out, from the game as the rules see it plus tonight's and the season's
// counts, so the pad's On Air panel and the scorebug page cannot disagree.
import * as L from './rules/logic.js';
import { positionOf } from './rules/roster.js';
import { engineGame, tonight, type EngineSide, type G, type StatKey } from './scoring.ts';
import { batting, innings, pitching, rate2, rate3, type SeasonLine } from './stats.ts';
import type { Broadcast, Cmd } from './broadcast.ts';
import type { Sport } from './sports.ts';
import type { Game, Lineup, Side } from './types.ts';

export type CardKind = 'batter' | 'pitcher' | 'dueup' | 'leaders' | 'box' | 'lineup' | 'defense' | 'matchup' | 'sponsor' | 'mid' | 'qr';

// How the scorebug looks: Scoreboard's own, Classic, or one of the eleven looks
// first drawn for Scoreboard (components/overlay/looks).
export const LOOKS = [
  ['pressbox', 'Scoreboard'], ['classic', 'Classic'], ['primetime', 'Prime Time'], ['bluesteel', 'Blue Steel'], ['forever20', 'Forever 20'], ['midnight', 'Midnight'],
  ['classic-green', 'Classic Green'], ['pinball-dmd', 'Pinball'], ['chalkboard', 'Chalkboard'], ['comic', 'Comic'],
  ['split-flap', 'Split Flap'], ['receipt', 'Receipt'], ['pixel-rpg', 'Pixel RPG'],
] as const;
export type Look = (typeof LOOKS)[number][0];
export type Line = Partial<Record<StatKey, number>>;

// The stream's layout. A scale of 1 is the size a thing was drawn at, which
// fills a lot of a picture; the default is well under it.
export const BUG_POS = ['tl', 'tc', 'tr', 'bl', 'bc', 'br'] as const;
export type BugPos = (typeof BUG_POS)[number];
export type Layout = { bug: { scale: number; pos: BugPos }; cards: { scale: number } };
export const BUG_SCALE = { min: 0.3, max: 1.2 }, CARD_SCALE = { min: 0.4, max: 1.2 };
export function layoutOf(l: Feed['layout']): Layout {
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    bug: { scale: num(l?.bug?.scale, BUG_SCALE.min, BUG_SCALE.max, 0.6), pos: (BUG_POS as readonly string[]).includes(l?.bug?.pos as string) ? (l!.bug!.pos as BugPos) : 'bl' },
    cards: { scale: num(l?.cards?.scale, CARD_SCALE.min, CARD_SCALE.max, 0.75) },
  };
}

// The QR code's layer. size is the code's side in the stream's units (128 is
// the picture's full width); pos is a corner, an edge or a side.
export const QR_POS = ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br'] as const;
export type QrPos = (typeof QR_POS)[number];
export type QrLayer = { on: boolean; size: number; pos: QrPos; opacity: number };
export const QR_SIZE = { min: 3, max: 40 }, QR_OPACITY = { min: 0.2, max: 1 };
// Whatever is stored, as something safe to draw.
export function qrLayer(q: Partial<QrLayer> | null | undefined): QrLayer {
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return {
    on: q?.on === true,
    size: num(q?.size, QR_SIZE.min, QR_SIZE.max, 10),
    pos: (QR_POS as readonly string[]).includes(q?.pos as string) ? (q!.pos as QrPos) : 'tr',
    opacity: num(q?.opacity, QR_OPACITY.min, QR_OPACITY.max, 1),
  };
}
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
  // The corner line that stays up, and the link On Air can raise as a QR code.
  bug?: { text: string | null; url: string | null } | null;
  // The link as a QR code, on its own layer: shown or not, and how it sits.
  qr?: Partial<QrLayer> | null;
  // How the stream is laid out: the scorebug's size and corner, the cards' size.
  layout?: { bug?: Partial<Layout['bug']>; cards?: Partial<Layout['cards']> } | null;
  // The last spot tapped in On Air: a new stamp plays one.
  spot?: { n: number; cut: 'pitch' | 'inning' } | null;
  // How the stream looks and sounds beyond the bug, and the last one-shot command.
  broadcast?: Broadcast | null;
  cmd?: Cmd | null;
  roster?: { id: string; num: string; name: string }[];
  team: FeedTeam; opponent: FeedTeam;
  game: (Pick<Game, 'id' | 'is_home' | 'status' | 'live'> & Partial<Pick<Game, 'clock' | 'settings' | 'starts_at' | 'venue' | 'venue_geo'>>
    & { seq: number; sport?: Sport }) | null;
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

// The words for a play worth a moment on Scoreboard's own bug, or null.
const MOMENTS: Record<string, string> = { H1: 'Single', H2: 'Double', H3: 'Triple', DP: 'Double play', SB: 'Stolen base', SF: 'Sac fly', BB: 'Walk', HBP: 'Hit by pitch' };
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

// What happened in the half that just ended, a name and a play at a time
// ("Vance walk"), for the mid-inning board. From the plate appearances the
// feed carries, so it needs nothing the stream does not already have.
export function halfRecap(feed: Feed, g: G): string[] {
  const inning = g.half === 'bottom' ? g.inning | 0 : (g.inning | 0) - 1;
  // After the top, the visitors just batted; after the bottom, the home side.
  const batted: Side = (g.half === 'bottom') === !!feed.game?.is_home ? 'them' : 'us';
  const lineup = feed.lineups?.[batted];
  return (feed.pas ?? []).filter((p) => p.side === batted && p.inning === inning).map((p) => {
    const b = lineup?.batters?.find((x) => x.bid === p.bid);
    const who = b ? (b.name ? b.name.trim().split(/\s+/).pop()! : `#${b.num}`) : '';
    return `${who} ${paText(p).toLowerCase()}`.trim();
  });
}
