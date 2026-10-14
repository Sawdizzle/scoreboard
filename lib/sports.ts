// The other sports. Their rules are Scoreboard v4's, carried over unchanged
// (lib/rules/football.js, soccer.js, basketball.js, volleyball.js): a game in,
// { type, patch, anim } out, the situation in live.state and the score in
// home_score / away_score. Here: what the pad and the stream need around them.
import * as B from './rules/basketball.js';
import * as F from './rules/football.js';
import * as S from './rules/soccer.js';
import * as V from './rules/volleyball.js';
import type { GameSettings } from './broadcast.ts';

export const SPORTS = ['baseball', 'football', 'soccer', 'basketball', 'volleyball'] as const;
export type Sport = (typeof SPORTS)[number];
export const SPORT_LABEL: Record<Sport, string> = { baseball: 'Baseball', football: 'Football', soccer: 'Soccer', basketball: 'Basketball', volleyball: 'Volleyball' };

export type SideKey = 'home' | 'away';
export type SportLive = { home_score?: number; away_score?: number; state?: Record<string, unknown> };
// What a rule returns. `anim` names the moment the stream plays for it.
export type SportRes = { type: string; patch: Record<string, unknown>; payload?: Record<string, unknown>; anim?: string | null; animMeta?: Record<string, unknown> };
export type SportG = SportLive & { time_limit_seconds: number };

// The game as the rules read it. They know one length of period, as v4's
// time limit; here it is the game's period_minutes setting.
export const sportGame = (live: SportLive, settings?: GameSettings | null): SportG =>
  ({ ...live, state: live.state ?? {}, time_limit_seconds: Math.round((settings?.period_minutes ?? 0) * 60) });

export { B as Basketball, F as Football, S as Soccer, V as Volleyball };

// Default period length, minutes: what a new game's clock is set to.
export const PERIOD_MINUTES: Record<Exclude<Sport, 'baseball'>, number> = { football: 12, basketball: 8, soccer: 30, volleyball: 0 };

const ORD = ['', '1st', '2nd', '3rd', '4th'];
const st = (live: SportLive) => (live.state ?? {}) as Record<string, unknown>;
const n = (v: unknown, d = 0) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// The period, the way the scorebug says it where baseball has its inning.
export function periodText(sport: Sport, live: SportLive) {
  const s = st(live);
  if (sport === 'football') { const q = n(s.quarter, n(s.period, 1)); return q > 4 ? (q > 5 ? `OT${q - 4}` : 'OT') : `Q${q}`; }
  if (sport === 'basketball') { const q = n(s.period, 1); return q > 4 ? (q > 5 ? `OT${q - 4}` : 'OT') : `Q${q}`; }
  if (sport === 'soccer') { const h = n(s.half, n(s.period, 1)); return h > 2 ? 'ET' : `${ORD[h]} half`; }
  if (sport === 'volleyball') {
    const v = V.vbState(live) as { set: number; sets: Record<SideKey, number> };
    return `Set ${n(s.set, n(s.period, v.set))} · sets ${v.sets.away}-${v.sets.home}`;
  }
  return '';
}
export const periodName = (sport: Sport, live: SportLive) =>
  periodText(sport, live).replace(/^Q(\d)$/, (_, q) => `${ORD[+q]} quarter`).replace(/^OT(\d*)$/, (_, k) => `Overtime${k ? ` ${k}` : ''}`);

// The situation line under the score: down and distance, fouls, cards, serve.
// `names` are the short team names, away and home.
export function situationText(sport: Sport, live: SportLive, names: Record<SideKey, string>) {
  if (sport === 'football') {
    const f = F.fbState(live) as { down: number; distance: number | 'goal'; possession: SideKey | null; home_timeouts: number; away_timeouts: number };
    const dd = `${ORD[f.down] ?? `${f.down}th`} & ${f.distance === 'goal' ? 'Goal' : f.distance}`;
    return f.possession ? `${names[f.possession]} ball · ${dd}` : dd;
  }
  if (sport === 'basketball') {
    const b = B.bkState(live) as { fouls: Record<SideKey, number> };
    const bonus = (['away', 'home'] as const).map((t) => B.bonusOf(b, t)).map((x, i) => (x ? `${names[i ? 'home' : 'away']} ${x.toLowerCase()}` : '')).filter(Boolean);
    return [`Fouls ${b.fouls.away}-${b.fouls.home}`, ...bonus].join(' · ');
  }
  if (sport === 'soccer') {
    const c = S.scState(live) as { cards: Record<SideKey, { y: number; r: number }>; stoppage: number };
    const cards = (['away', 'home'] as const).map((t) => {
      const k = c.cards[t]; return k.y || k.r ? `${names[t]} ${'🟨'.repeat(Math.min(k.y, 3))}${'🟥'.repeat(Math.min(k.r, 2))}` : '';
    }).filter(Boolean);
    return [c.stoppage ? `+${c.stoppage}` : '', ...cards].filter(Boolean).join(' · ');
  }
  if (sport === 'volleyball') {
    const v = V.vbState(live) as { serve: SideKey | null; target: number };
    return [v.serve ? `${names[v.serve]} serving` : '', `to ${v.target}`].filter(Boolean).join(' · ');
  }
  return '';
}

// Timeouts left, for the scorebug's pips; null where the sport has none here.
export function timeoutsOf(sport: Sport, live: SportLive): Record<SideKey, number> | null {
  if (sport === 'football') { const f = F.fbState(live) as Record<string, number>; return { home: f.home_timeouts, away: f.away_timeouts }; }
  if (sport === 'basketball') return (B.bkState(live) as { timeouts: Record<SideKey, number> }).timeouts;
  return null;
}

// Who has the ball (football) or the serve (volleyball), for the possession arrow.
export function possessionOf(sport: Sport, live: SportLive): SideKey | null {
  if (sport === 'football') return (F.fbState(live) as { possession: SideKey | null }).possession;
  if (sport === 'volleyball') return (V.vbState(live) as { serve: SideKey | null }).serve;
  return null;
}

// Soccer's clock counts up inside the play state; the others use games.clock.
export const soccerSeconds = (live: SportLive, now = Date.now()) => Math.floor(S.elapsedSeconds(live, now) as number);

// The pad's one line for what a rule did.
const SAID: Record<string, string> = {
  td: 'Touchdown', fg: 'Field goal', xp: 'Extra point', '2pt': 'Two-point try', safety: 'Safety', turnover: 'Turnover', 'fb-kick': 'Change of possession',
  'fb-poss': 'Possession', 'fb-down': 'Down', 'fb-dist': 'Distance', 'fb-first': 'First down', 'fb-to': 'Timeouts', 'fb-quarter': 'Quarter',
  goal: 'Goal', 'sc-half': 'Half', 'sc-card': 'Card', 'sc-stop': 'Stoppage time', 'sc-clk': 'Clock',
  'bk-score': 'Basket', 'bk-foul': 'Foul', 'bk-period': 'Period', 'bk-to': 'Timeouts',
  'vb-point': 'Point', 'vb-set': 'Set won', 'vb-serve': 'Serve', 'vb-target': 'Set target', 'vb-setno': 'Set', 'vb-sets': 'Sets',
  score: 'Score corrected', end_game: 'Game ended', reopen_game: 'Game reopened',
};
export const sportSaid = (r: SportRes) => {
  if (r.type === 'bk-score') { const p = Number(r.payload?.pts) || 0; return p < 0 ? `Took back ${-p}` : p === 3 ? 'Three' : p === 1 ? 'Free throw' : 'Basket'; }
  return SAID[r.type] ?? 'Saved';
};
