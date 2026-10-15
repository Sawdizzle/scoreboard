// The post-game content pack: what Claude is asked for, what it is given, and
// the check its answer must pass before anyone sees it.
//
// Claude gets the game's facts (lib/summarize.ts) and nothing else, so it can
// only write about plays that happened, by players the public may see named.
// Its answer is then checked against the same facts: every score it writes
// must be one the game passed through, every inning one that was played, and
// its player of the game someone the facts name. One retry with the problems
// listed; whatever is still wrong is saved with the draft as warnings, for the
// coach to fix before publishing.
import { z } from 'zod';
import type { GameFacts } from './summarize.ts';

export const RECAP_MODEL = 'claude-sonnet-5-5';

export const RecapContent = z.object({
  headline: z.string().describe('Under 80 characters. Names the result.'),
  recap: z.string().describe('3 to 5 short paragraphs separated by blank lines.'),
  social: z.object({
    instagram: z.string().describe('Caption with 3 to 6 hashtags at the end.'),
    facebook: z.string().describe('2 to 4 sentences for parents and family.'),
    x: z.string().describe('At most 280 characters including hashtags.'),
  }),
  website_post: z.object({
    title: z.string(),
    body_markdown: z.string().describe('The recap for the team website, in Markdown, with a line score table.'),
  }),
  player_of_the_game: z.object({
    name_or_number: z.string().describe('Exactly as the facts write the player, or empty when the facts name no one.'),
    reason: z.string().describe('One sentence from the facts, or empty.'),
  }),
});
export type RecapContent = z.infer<typeof RecapContent>;

// Who, where and when: what the facts do not carry.
export type RecapContext = { team: string; opponent: string; date: string | null; venue: string | null; season: string | null; ageGroup: string | null };

// Fixed, so it caches between calls.
export const RECAP_SYSTEM = `You write post-game content for a youth sports team's broadcast: a recap, social captions and a website post.

You are given the game's facts as JSON. They are the only source of truth.
- Use only what the facts say. Never invent a play, a score, an inning, a statistic, a quote or a player.
- Name a player only as the facts write them ("Johnny Vance", "J. Vance" or "#12"). A play with no batter named happened, but say it without a name ("an RBI single"). Never guess who it was.
- The facts' "gaps" are runs the line score has that the play log does not explain. You may give that inning's total from the line score, but never say how those runs scored.
- Scores: write them as "6-5", winner first, and only scores from the facts: the final, or the score after a scoring play.
- "us" is the team you write for; "them" is the opponent. Write as the team's own broadcast: warm, upbeat, proud of the effort. These are kids: never criticise a player, an umpire or the other team. A loss is told with credit to the opponent and to our effort.
- When the facts are thin (few plays, no names), write less rather than fill it in.
- The X post is at most 280 characters including hashtags.
- Player of the game: pick from the facts' standouts on our side when there are any, else leave both fields empty.`;

export function recapPrompt(facts: GameFacts, ctx: RecapContext) {
  return `Write the content pack for this game.

Team (us): ${ctx.team}
Opponent (them): ${ctx.opponent}
Date: ${ctx.date ?? 'not given'}
Venue: ${ctx.venue ?? 'not given'}
Season: ${ctx.season ?? 'not given'}${ctx.ageGroup ? `\nAge group: ${ctx.ageGroup}` : ''}

<facts>
${JSON.stringify(facts)}
</facts>`;
}

// Every string in the answer, for the checks to read.
const texts = (c: RecapContent) => [c.headline, c.recap, c.social.instagram, c.social.facebook, c.social.x,
  c.website_post.title, c.website_post.body_markdown, c.player_of_the_game.reason];

// "6-5" and "6–5" both; a scorebook code like "6-3" is allowed only when the facts carry it.
const PAIR = /(?<![\d.])(\d{1,2})\s*[-–—]\s*(\d{1,2})(?![\d.])/g;
const ORDINAL = /\b(\d{1,2})(?:st|nd|rd|th)\b/gi;

export function checkRecap(c: RecapContent, facts: GameFacts): string[] {
  const problems: string[] = [];
  const known = new Set<string>();
  const pair = (a: number, b: number) => { known.add(`${a}-${b}`); known.add(`${b}-${a}`); };
  pair(facts.score.us, facts.score.them);
  pair(0, 0);
  for (const s of facts.scoringPlays) pair(s.score.us, s.score.them);
  for (const m of JSON.stringify(facts).matchAll(PAIR)) pair(Number(m[1]), Number(m[2]));
  // A v4 log with gaps: the score at the end of each half, from the line score.
  const run = { us: 0, them: 0 };
  const order = facts.teams.home === 'us' ? (['them', 'us'] as const) : (['us', 'them'] as const);
  for (const r of facts.lineScore.innings) for (const s of order) {
    run[s] += r[s] ?? 0;
    pair(run.us, run.them);
  }

  const all = texts(c).join('\n');
  for (const m of all.matchAll(PAIR)) {
    if (!known.has(`${Number(m[1])}-${Number(m[2])}`)) problems.push(`"${m[0]}" is not a score or play code from the facts.`);
  }
  const innings = Math.max(facts.inningsPlayed, facts.lineScore.innings.length);
  for (const m of all.matchAll(ORDINAL)) {
    if (Number(m[1]) > innings) problems.push(`"${m[0]}": the game had ${innings} innings.`);
  }
  if (c.social.x.length > 280) problems.push(`The X post is ${c.social.x.length} characters; the limit is 280.`);
  if (!c.headline.trim() || !c.recap.trim()) problems.push('The headline and recap must not be empty.');

  const potg = c.player_of_the_game.name_or_number.trim();
  if (potg) {
    const names = new Set<string>();
    for (const s of facts.standouts) names.add(s.name);
    for (const s of facts.scoringPlays) { if (s.batter) names.add(s.batter); s.scorers.forEach((x) => names.add(x)); }
    for (const p of facts.pitchingChanges) if (p.pitcher) names.add(p.pitcher);
    if (!names.has(potg)) problems.push(`Player of the game "${potg}" is not a player the facts name.`);
  }
  return [...new Set(problems)];
}
