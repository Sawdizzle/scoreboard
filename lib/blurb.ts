// The pregame blurb on Starting Soon: two lines and a storyline about the game
// about to start, written from facts the app already has. No player is named:
// it goes on the stream before anyone has been checked for a public name.
//
// Claude gets matchupFacts() and nothing else; checkBlurb() holds the answer
// to them. The stream shows a blurb only after the operator taps Use.
import { z } from 'zod';

export const BLURB_MODEL = 'claude-haiku-5-5';
export const BLURB_MAX = 60;

export const BlurbContent = z.object({
  line1: z.string().describe(`At most ${BLURB_MAX} characters. The hook: who, and why this game matters.`),
  line2: z.string().describe(`At most ${BLURB_MAX} characters. A second fact: a record, a streak, a last meeting.`),
  storyline: z.string().describe(`At most ${BLURB_MAX} characters. One line on what to watch for, from the facts.`),
});
export type BlurbContent = z.infer<typeof BlurbContent>;

type Live = { home_score?: unknown; away_score?: unknown };
export type PastGame = {
  id: string; starts_at: string | null; is_home: boolean; status: string; counts_for_stats: boolean;
  season_id: string | null; opponent_id?: string | null; opponent_team_id: string | null; opponent_name: string;
  sport?: string | null; live: Live | null;
};
type Result = 'W' | 'L' | 'T';
export type MatchupFacts = {
  teams: { us: string; them: string; home: 'us' | 'them' };
  date: string | null; time: string | null; venue: string | null; season: string | null;
  // This season's final games that count, before this one.
  record: { w: number; l: number; t: number; text: string };
  streak: { result: Result; games: number } | null;
  last: { date: string | null; opponent: string; result: Result; score: string }[];
  // Earlier final games against this opponent, newest first.
  meetings: { date: string | null; result: Result; score: string }[];
};

const n = (v: unknown) => Number(v) || 0;
const fmt = (iso: string | null, tz: string, o: Intl.DateTimeFormatOptions) => (iso ? new Date(iso).toLocaleString('en-US', { ...o, timeZone: tz }) : null);

// Our score and theirs in a final game, and how it came out.
function outcome(g: PastGame) {
  const h = n(g.live?.home_score), a = n(g.live?.away_score);
  const us = g.is_home ? h : a, them = g.is_home ? a : h;
  const result: Result = us > them ? 'W' : us < them ? 'L' : 'T';
  // Written the way a broadcast says it: the winner's runs first.
  return { result, score: `${Math.max(us, them)}-${Math.min(us, them)}` };
}

const sameOpponent = (a: PastGame, b: PastGame) =>
  (!!a.opponent_team_id && a.opponent_team_id === b.opponent_team_id) ||
  (!!a.opponent_id && a.opponent_id === b.opponent_id) ||
  a.opponent_name.trim().toLowerCase() === b.opponent_name.trim().toLowerCase();

export function matchupFacts({ game, games, teams, venue, season, tz = 'America/Chicago' }: {
  game: PastGame; games: PastGame[]; teams: { us: string; them: string }; venue: string | null; season: string | null; tz?: string;
}): MatchupFacts {
  const start = game.starts_at ? Date.parse(game.starts_at) : Infinity;
  const before = games
    .filter((g) => g.id !== game.id && g.status === 'final' && (g.sport ?? 'baseball') === (game.sport ?? 'baseball'))
    .filter((g) => (g.starts_at ? Date.parse(g.starts_at) : -Infinity) < start)
    .sort((x, y) => Date.parse(y.starts_at ?? '1970-01-01') - Date.parse(x.starts_at ?? '1970-01-01'));
  const day = (g: PastGame) => fmt(g.starts_at, tz, { month: 'short', day: 'numeric' });

  const season_ = before.filter((g) => g.counts_for_stats && game.season_id && g.season_id === game.season_id);
  const rec = { w: 0, l: 0, t: 0 };
  for (const g of season_) rec[({ W: 'w', L: 'l', T: 't' } as const)[outcome(g).result]] += 1;

  let streak: MatchupFacts['streak'] = null;
  for (const g of season_) {
    const r = outcome(g).result;
    if (!streak) streak = { result: r, games: 1 };
    else if (streak.result === r) streak.games += 1;
    else break;
  }

  return {
    teams: { ...teams, home: game.is_home ? 'us' : 'them' },
    date: fmt(game.starts_at, tz, { weekday: 'long', month: 'long', day: 'numeric' }),
    time: fmt(game.starts_at, tz, { hour: 'numeric', minute: '2-digit' }),
    venue, season,
    record: { ...rec, text: rec.t ? `${rec.w}-${rec.l}-${rec.t}` : `${rec.w}-${rec.l}` },
    streak: streak && streak.games >= 2 ? streak : null,
    last: before.slice(0, 3).map((g) => ({ date: day(g), opponent: g.opponent_name, ...outcome(g) })),
    meetings: before.filter((g) => sameOpponent(g, game)).slice(0, 5).map((g) => ({ date: day(g), ...outcome(g) })),
  };
}

export const BLURB_SYSTEM = `You write a short pregame blurb for a youth sports team's live stream. It shows on the "Starting soon" screen before the game.

You are given the matchup's facts as JSON. They are the only source of truth.
- Three lines: line1 (the hook), line2 (a second fact), storyline (what to watch for). Each at most ${BLURB_MAX} characters.
- Use only the facts: the teams, the date and venue, our record, our streak, our last games and earlier meetings with this opponent. Never invent a record, a score, a ranking, a stat or a rivalry.
- Never name a player. Never mention the weather.
- Write records and scores exactly as the facts write them ("5-2", "9-2").
- "us" is the team whose stream this is. Upbeat and welcoming, never mocking the opponent: these are kids.
- With little history (no record, no meetings), keep it simple: who is playing, where, and a welcome.
- No hashtags, no emoji.`;

export const blurbPrompt = (f: MatchupFacts) => `Write the pregame blurb for this game.

<facts>
${JSON.stringify(f)}
</facts>`;

const PAIR = /(?<!\d|\d\.)(\d{1,2})\s*[-–—]\s*(\d{1,2})(?:\s*[-–—]\s*(\d{1,2}))?(?!\d|\.\d)/g;

export function checkBlurb(b: BlurbContent, f: MatchupFacts): string[] {
  const problems: string[] = [];
  const known = new Set<string>([f.record.text, `${f.record.w}-${f.record.l}`]);
  for (const g of [...f.last, ...f.meetings]) {
    known.add(g.score);
    known.add(g.score.split('-').reverse().join('-'));
  }
  for (const [k, v] of Object.entries(b) as [keyof BlurbContent, string][]) {
    if (v.length > BLURB_MAX) problems.push(`${k} is ${v.length} characters; the limit is ${BLURB_MAX}.`);
    for (const m of v.matchAll(PAIR)) {
      const s = m.slice(1).filter(Boolean).map(Number).join('-');
      if (!known.has(s)) problems.push(`"${m[0]}" is not a record or score from the facts.`);
    }
  }
  if (!b.line1.trim()) problems.push('line1 must not be empty.');
  return [...new Set(problems)];
}
