// The public side of a game: public_game() as it arrives, and the box score
// worked out from it. No account, no staff names: what a grandparent sees.
import { ordinal, paText, type Feed, type FeedTeam, type Line, type Pa } from './onair.ts';
import { innings } from './stats.ts';
import type { Game, Lineup, Side } from './types.ts';

export type PublicTeam = FeedTeam & { slug: string | null };
export type PublicGame = {
  v: string;
  team: PublicTeam; opponent: PublicTeam;
  game: Pick<Game, 'id' | 'is_home' | 'status' | 'live' | 'starts_at' | 'venue' | 'counts_for_stats'> & { seq: number };
  season: Feed['season'];
  lineups: { us: Lineup | null; them: Lineup | null };
  tonight: (Line & { side: Side; bid: string })[];
  pas: (Pa & { rbi: number })[];
};

// The same game in the stream's shape, so one view (lib/onair) reads both.
export const asFeed = (p: PublicGame): Feed =>
  ({ ...p, show_line: false, auto_card: false, card: null, season_stats: [] });

export type BoxRow = { key: string; num: string; name: string; cells: string[] };
const n = (v: number | undefined) => String(v ?? 0);

// One side's box: hitters in batting order (then anyone who batted and has
// since left the lineup), and everyone who pitched.
export function boxLines(p: PublicGame, side: Side) {
  const lineup = p.lineups[side];
  const lines = new Map(p.tonight.filter((r) => r.side === side).map((r) => [r.bid, r]));
  const who = new Map((lineup?.batters ?? []).map((b) => [b.bid, b]));
  const label = (bid: string) => {
    const b = who.get(bid);
    return { key: bid, num: b?.num ?? '', name: b ? b.name || (b.num ? `No. ${b.num}` : 'Player') : 'Substitute' };
  };
  const order = [...(lineup?.batters ?? []).filter((b) => b.num || b.name).map((b) => b.bid),
    ...[...lines.keys()].filter((bid) => !who.has(bid) && (lines.get(bid)!.b_pa ?? 0) > 0)];
  const batting: BoxRow[] = order.map((bid) => {
    const l: Line = lines.get(bid) ?? {};
    return { ...label(bid), cells: [n(l.b_ab), n(l.b_r), n(l.b_h), n(l.b_rbi), n(l.b_bb), n(l.b_so)] };
  });
  const pitching: BoxRow[] = [...lines.values()].filter((l) => (l.p_bf ?? 0) > 0 || (l.p_outs ?? 0) > 0 || (l.p_pitches ?? 0) > 0)
    .map((l) => ({ ...label(l.bid), cells: [innings(l.p_outs ?? 0), n(l.p_h), n(l.p_r), n(l.p_er), n(l.p_bb), n(l.p_so), n(l.p_pitches)] }));
  return { batting, pitching };
}
export const BAT_COLS = ['AB', 'R', 'H', 'RBI', 'BB', 'SO'];
export const PITCH_COLS = ['IP', 'H', 'R', 'ER', 'BB', 'SO', 'P'];

// Each time up, newest first: "3rd · Johnny Vance · Double, 2 RBI".
export function plays(p: PublicGame) {
  const name = (side: Side, bid: string) => {
    const b = p.lineups[side]?.batters?.find((x) => x.bid === bid);
    return b ? b.name || `No. ${b.num}` : 'Substitute';
  };
  return p.pas.map((pa, i) => ({
    key: i, side: pa.side, inning: pa.inning ? ordinal(pa.inning) : '', who: name(pa.side, pa.bid),
    what: paText(pa) + (pa.rbi ? `, ${pa.rbi > 1 ? `${pa.rbi} ` : ''}RBI` : ''),
  })).reverse();
}

// "W 5-3", "L 2-4", "T 3-3" for the team whose page this is; null until final.
export function result(g: Pick<Game, 'is_home' | 'status' | 'live'>) {
  if (g.status !== 'final') return null;
  const live = g.live as { home_score?: number; away_score?: number };
  const us = Number(g.is_home ? live.home_score : live.away_score) || 0;
  const them = Number(g.is_home ? live.away_score : live.home_score) || 0;
  return `${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}-${them}`;
}
