// Where a batter's balls in play went, for the spray chart on the player page.
// The pad keeps a spot on a play when the scorer drags the fielder to where
// the ball was fielded, or shows where a hit went (payload.inputs.loc): whole
// numbers 0-100 across and down the pad's fielder picker, home plate at 50, 92
// and second base at 50, 44. Older plays have none, and neither do a hit whose
// "where did it go" was skipped or a home run. Pure: the page reads game_events
// and game_stats and hands them in.
import * as L from './rules/logic.js';
import type { Side } from './types.ts';

export type SprayEvent = {
  id: number; type: string;
  // The season of the game it was in: the card shows one season at a time.
  season_id: string | null;
  payload: { play?: { kind?: string }; inputs?: { kind?: string; bb?: unknown; loc?: unknown }; reached?: number } | null;
};
export type SprayStat = { event_id: number; side: Side; bid: string; b_pa?: number };

// What came of it, as the chart draws it: a hit, an out, or safe without a
// hit (an error or a fielder's choice). Anything else never put the ball in
// play: a walk, a strikeout, a dropped third strike.
export type SprayResult = 'hit' | 'out' | 'reached';
const RESULT: Record<string, SprayResult> = {
  H1: 'hit', H2: 'hit', H3: 'hit', HR: 'hit',
  GB: 'out', FB: 'out', LD: 'out', PU: 'out', DP: 'out', SF: 'out', SAC: 'out',
  E: 'reached', FC: 'reached',
};
// How it was hit, in the pad's words (components/pad/PadSheets.tsx).
const BB_LABEL: Record<string, string> = { GB: 'ground ball', HGB: 'hard grounder', LD: 'line drive', FB: 'fly ball', PU: 'pop up', BUNT: 'bunt' };

export type Spot = { x: number; y: number };
export type SprayBall = { event_id: number; season_id: string | null; kind: string; bb: string | null; result: SprayResult; at: Spot | null };

// A spot as the rules keep it (lib/rules/logic.js): whole numbers 0-100, or nothing.
const spot = (loc: unknown): Spot | null => {
  const l = loc as { x?: unknown; y?: unknown } | null | undefined;
  if (typeof l?.x !== 'number' || typeof l?.y !== 'number' || !Number.isFinite(l.x) || !Number.isFinite(l.y)) return null;
  const c = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  return { x: c(l.x), y: c(l.y) };
};

// One batter's balls in play, oldest first: the plays whose plate appearance
// is on our side's stat row for `bid` (the player's id), each once.
export function sprayBalls(events: SprayEvent[], stats: SprayStat[], bid: string): SprayBall[] {
  const mine = new Set(stats.filter((s) => s.side === 'us' && s.bid === bid && Number(s.b_pa) > 0).map((s) => s.event_id));
  const balls: SprayBall[] = [];
  for (const e of events) {
    if (!mine.delete(e.id)) continue;
    const p = e.payload ?? {};
    // The play-by-play note says what it was; an older home run or hit says it by its type.
    const kind = p.play?.kind ?? p.inputs?.kind ?? (e.type === 'homerun' ? 'HR' : e.type === 'hit' && p.reached ? `H${p.reached}` : '');
    const result = RESULT[kind];
    if (!result) continue;
    const bb = typeof p.inputs?.bb === 'string' ? p.inputs.bb : null;
    balls.push({ event_id: e.id, season_id: e.season_id, kind, bb, result, at: spot(p.inputs?.loc) });
  }
  return balls.sort((a, b) => a.event_id - b.event_id);
}

// The chart's key: how many of each it draws, and how many balls in play it can't.
export function sprayCounts(balls: SprayBall[]) {
  const n = { hit: 0, out: 0, reached: 0, unspotted: 0 };
  for (const b of balls) {
    if (b.at) n[b.result]++;
    else n.unspotted++;
  }
  return n;
}

// "Single · line drive", for a mark's tooltip. A flyout was a fly ball: it
// says so once.
export function sprayLabel(b: SprayBall) {
  const what = (L.PLAY_LABEL as Record<string, string>)[b.kind] ?? b.kind;
  return b.bb && b.bb !== b.kind && BB_LABEL[b.bb] ? `${what} · ${BB_LABEL[b.bb]}` : what;
}

// Where each spotted ball is drawn on a chart `aspect` times as wide as it is
// tall, in the chart's own units: 0 to 100 × aspect across, 0 to 100 down. A
// hit placed by tapping a fielder lands on that fielder's spot, so balls on
// one spot are set in rings `gap` apart around it, every one of them in sight.
export type SprayPlace = { ball: SprayBall; x: number; y: number };
export function sprayPlaces(balls: SprayBall[], aspect: number, gap: number): SprayPlace[] {
  const seen = new Map<string, number>();
  const places: SprayPlace[] = [];
  const r2 = (v: number) => Math.round(v * 100) / 100;
  for (const ball of balls) {
    if (!ball.at) continue;
    const key = `${ball.at.x},${ball.at.y}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    // Six to a ring, each ring turned half a step from the one inside it.
    const ring = Math.ceil(n / 6);
    const a = n ? ((n - 1) % 6 + (ring - 1) / 2) * (Math.PI / 3) : 0;
    const x = ball.at.x * aspect + ring * gap * Math.cos(a), y = ball.at.y + ring * gap * Math.sin(a);
    places.push({ ball, x: r2(Math.max(0, Math.min(100 * aspect, x))), y: r2(Math.max(0, Math.min(100, y))) });
  }
  return places;
}
