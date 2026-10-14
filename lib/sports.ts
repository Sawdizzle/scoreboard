// The other sports, score only: the score, the period, and for volleyball the
// sets. Baseball has its own rules engine (lib/rules); these are small enough
// to live here. Each action is a patch for apply_play, as a baseball play is.
export const SPORTS = ['baseball', 'football', 'soccer', 'basketball', 'volleyball'] as const;
export type Sport = (typeof SPORTS)[number];
export const SPORT_LABEL: Record<Sport, string> = { baseball: 'Baseball', football: 'Football', soccer: 'Soccer', basketball: 'Basketball', volleyball: 'Volleyball' };

export type SideKey = 'home' | 'away';
export type SportLive = { home_score?: number; away_score?: number; state?: { period?: number; sets?: Record<SideKey, number>; setLog?: Record<SideKey, number>[] } };
export type SportRes = { type: string; patch: Record<string, unknown>; text: string };

type Def = { points: [number, string][]; periods: number; name: (n: number) => string; short: (n: number) => string; unit: string };
const ORD = ['', '1st', '2nd', '3rd', '4th'];
const DEFS: Record<Exclude<Sport, 'baseball'>, Def> = {
  football: { points: [[6, 'Touchdown'], [3, 'Field goal'], [2, 'Two points'], [1, 'Extra point']], periods: 4, unit: 'quarter',
    name: (n) => (n > 4 ? (n > 5 ? `Overtime ${n - 4}` : 'Overtime') : `${ORD[n]} quarter`), short: (n) => (n > 4 ? 'OT' : `Q${n}`) },
  basketball: { points: [[3, 'Three'], [2, 'Two'], [1, 'Free throw']], periods: 4, unit: 'quarter',
    name: (n) => (n > 4 ? (n > 5 ? `Overtime ${n - 4}` : 'Overtime') : `${ORD[n]} quarter`), short: (n) => (n > 4 ? 'OT' : `Q${n}`) },
  soccer: { points: [[1, 'Goal']], periods: 2, unit: 'half',
    name: (n) => (n > 2 ? 'Extra time' : `${ORD[n]} half`), short: (n) => (n > 2 ? 'ET' : `${ORD[n]} half`) },
  volleyball: { points: [[1, 'Point']], periods: 5, unit: 'set', name: (n) => `Set ${n}`, short: (n) => `Set ${n}` },
};
export const sportDef = (s: Sport) => DEFS[s as Exclude<Sport, 'baseball'>];

const num = (v: unknown) => Math.max(0, Number(v) || 0);
export const periodOf = (live: SportLive) => Math.max(1, num(live.state?.period) || 1);
export const setsOf = (live: SportLive): Record<SideKey, number> => ({ home: num(live.state?.sets?.home), away: num(live.state?.sets?.away) });

// Points for a side; a negative number takes them back (never below zero).
export function addPoints(live: SportLive, side: SideKey, n: number, label = ''): SportRes | null {
  const key = `${side}_score` as const;
  const next = Math.max(0, num(live[key]) + n);
  if (next === num(live[key])) return null;
  return { type: 'score', patch: { [key]: next }, text: n > 0 ? `${label || 'Score'} +${n}` : `Took back ${-n}` };
}
export function stepPeriod(sport: Sport, live: SportLive, d: 1 | -1): SportRes | null {
  const next = periodOf(live) + d;
  if (next < 1 || next > sportDef(sport).periods + 4) return null;
  return { type: 'period', patch: { state: { ...(live.state ?? {}), period: next } }, text: sportDef(sport).name(next) };
}
// Volleyball: the set goes to whoever is ahead, the score starts over.
export function endSet(live: SportLive): SportRes | null {
  const h = num(live.home_score), a = num(live.away_score);
  if (h === a) return null;
  const sets = setsOf(live);
  sets[h > a ? 'home' : 'away'] += 1;
  const log = [...(live.state?.setLog ?? []), { home: h, away: a }];
  return { type: 'endset', patch: { home_score: 0, away_score: 0, state: { ...(live.state ?? {}), period: periodOf(live) + 1, sets, setLog: log } },
    text: `Set to ${h > a ? 'home' : 'away'}, ${Math.max(h, a)}-${Math.min(h, a)}` };
}

// What the scorebug says where baseball has its inning and count.
export function periodText(sport: Sport, live: SportLive) {
  const p = sportDef(sport).short(periodOf(live));
  if (sport !== 'volleyball') return p;
  const s = setsOf(live);
  return `${p} · sets ${s.away}-${s.home}`;
}
