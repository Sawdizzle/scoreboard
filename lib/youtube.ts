// A game video's YouTube title, description and chapters. The chapters and the
// key-moment times are worked out from the play log, each play timed by when
// it was tapped on the pad (payload.at) or else saved, against when the
// stream went live. Claude writes only the title, a short intro and the
// hashtags; everything with a number in it is built here.
import { z } from 'zod';
import { paText, ordinal } from './onair.ts';
import { readEvent, type GameFacts, type SummaryEvent } from './summarize.ts';

export const YOUTUBE_MODEL = 'claude-haiku-5-5';

export const YoutubeText = z.object({
  title: z.string().describe('At most 90 characters: both teams, the final score, and the date as "Oct 17".'),
  intro: z.string().describe('Two or three sentences for the top of the description, from the facts.'),
  hashtags: z.array(z.string()).describe('Three to five hashtags, each starting with #, no spaces.'),
});
export type YoutubeText = z.infer<typeof YoutubeText>;

export const YOUTUBE_SYSTEM = `You write the YouTube title and opening lines for a youth baseball game's stream replay, from the game's facts as JSON. They are the only source of truth.
- Title: at most 90 characters, both teams and the final score (winner first, as "10-2") and the short date. No emoji, no clickbait, no all caps.
- Intro: two or three warm sentences a family member would like: the result and one or two moments from the facts. Never invent a play, a score or a player; name players only as the facts write them.
- Hashtags: three to five, team-focused, like #BlueSteel and #YouthBaseball.
- These are kids: never criticise a player, an umpire or the other team.`;

export const youtubePrompt = (facts: GameFacts, date: string | null) =>
  `Write the YouTube title, intro and hashtags for this game${date ? ` (played ${date})` : ''}.\n\n<facts>\n${JSON.stringify(facts)}\n</facts>`;

export type Mark = { at: string; label: string };
const when = (e: SummaryEvent) => {
  const at = (e.payload as { at?: unknown } | null)?.at;
  return typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : e.created_at ?? null;
};

// The start of each half-inning, and each play that scored, with their times.
export function videoMarks(events: SummaryEvent[], facts: GameFacts): { halves: Mark[]; scoring: Mark[]; first: string | null } {
  const halves: Mark[] = [], scoring: Mark[] = [];
  const awayIsUs = facts.teams.home === 'them';
  const runsIn = (inning: number, half: 'top' | 'bottom') => {
    const side = (half === 'top') === awayIsUs ? 'us' : 'them';
    return facts.lineScore.innings.find((r) => r.inning === inning)?.[side] ?? null;
  };
  const seen = new Set<string>();
  events.forEach((e, i) => {
    const at = when(e);
    if (!at) return;
    const { inning, half, kind, note } = readEvent(e);
    const key = `${inning}${half}`;
    if (!seen.has(key) && e.type !== 'end_game' && e.type !== 'reopen_game') {
      seen.add(key);
      const runs = runsIn(inning, half);
      halves.push({ at, label: `${half === 'top' ? 'Top' : 'Bottom'} ${ordinal(inning)}${runs ? ` · ${runs} run${runs > 1 ? 's' : ''}` : ''}` });
    }
    // Runs on this play: the note says so (v4), or the score moved (the pad).
    let runs = Number((note as { runs?: number }).runs) || 0;
    if (!runs && e.prev_live) {
      const next = events[i + 1]?.prev_live;
      if (next) runs = Math.max(0, (Number(next.home_score) || 0) + (Number(next.away_score) || 0) - (Number(e.prev_live.home_score) || 0) - (Number(e.prev_live.away_score) || 0));
    }
    if (runs > 0 && !e.type.startsWith('adj')) {
      const what = kind === 'run' ? 'Run scored' : paText({ kind, code: (note as { code?: string }).code ?? null });
      scoring.push({ at, label: `${half === 'top' ? 'Top' : 'Bottom'} ${ordinal(inning)} · ${what}, ${runs} run${runs > 1 ? 's' : ''}` });
    }
  });
  // A game brought in from v4 has every play stamped with the moment it was
  // imported: no real times, so no chapters.
  const span = halves.length > 1 ? Date.parse(halves[halves.length - 1].at) - Date.parse(halves[0].at) : 0;
  if (span < 60000) return { halves: [], scoring: [], first: null };
  return { halves, scoring, first: halves[0]?.at ?? null };
}

// "1:02:03" or "12:03", as YouTube reads timestamps.
export function stamp(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

// Chapters as YouTube accepts them: start at 0:00, in order, at least 10 s
// apart, at least three. Fewer than three and there are no chapters.
export function chapters(marks: Mark[], streamStart: string): string[] {
  const t0 = Date.parse(streamStart);
  const out: { s: number; label: string }[] = [{ s: 0, label: 'Pregame' }];
  for (const m of marks) {
    const s = Math.round((Date.parse(m.at) - t0) / 1000);
    if (s < 10) { out[0] = { s: 0, label: m.label }; continue; }
    if (s - out[out.length - 1].s < 10) continue;
    out.push({ s, label: m.label });
  }
  return out.length >= 3 ? out.map((c) => `${stamp(c.s)} ${c.label}`) : [];
}

// The whole description: intro, final and line score, chapters, key moments, hashtags.
export function description(o: { text: YoutubeText; facts: GameFacts; halves: Mark[]; scoring: Mark[]; streamStart: string | null }) {
  const { facts } = o;
  const [away, home] = facts.teams.home === 'us' ? (['them', 'us'] as const) : (['us', 'them'] as const);
  const row = (s: 'us' | 'them') => `${facts.teams[s]}: ${facts.lineScore.innings.map((r) => r[s] ?? '-').join(' ')}  (R ${facts.lineScore[s].r}, H ${facts.lineScore[s].h}, E ${facts.lineScore[s].e})`;
  const parts = [o.text.intro.trim(), '',
    `Final: ${facts.teams[away]} ${facts.score[away]}, ${facts.teams[home]} ${facts.score[home]}`, row(away), row(home)];
  if (o.streamStart) {
    const ch = chapters(o.halves, o.streamStart);
    if (ch.length) parts.push('', 'Chapters', ...ch);
    const t0 = Date.parse(o.streamStart);
    const key = o.scoring.map((m) => ({ s: (Date.parse(m.at) - t0) / 1000, label: m.label })).filter((m) => m.s >= 0);
    if (key.length) parts.push('', 'Scoring plays', ...key.map((m) => `${stamp(m.s)} ${m.label}`));
  }
  const tags = o.text.hashtags.map((h) => `#${h.replace(/^#+/, '').replace(/\s+/g, '')}`).filter((h) => h.length > 1).slice(0, 5);
  if (tags.length) parts.push('', tags.join(' '));
  return parts.join('\n');
}

export function checkYoutube(t: YoutubeText, known: Set<string>, problemsIn: (text: string, known: Set<string>) => string[]): string[] {
  return [
    ...(t.title.length > 100 ? [`The title is ${t.title.length} characters; YouTube allows 100.`] : []),
    ...(/[<>]/.test(t.title + t.intro) ? ['No angle brackets: YouTube rejects them.'] : []),
    ...problemsIn(`${t.title}\n${t.intro}`, known),
  ];
}
