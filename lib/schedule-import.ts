// Games from a pasted schedule: a tournament email, a league page, a text from
// the coach. Claude picks out this team's games; this file checks them, turns
// local times into instants, and spots ones already on the schedule. Nothing
// is added until the coach ticks them and taps Add.
import { z } from 'zod';

export const SCHEDULE_MODEL = 'claude-sonnet-5-5';
export const TZ = 'America/Chicago';

export const ScheduleRead = z.object({
  games: z.array(z.object({
    date: z.string().describe('YYYY-MM-DD'),
    time: z.string().describe('First pitch as 24-hour HH:MM in local time, or empty if not given.'),
    opponent: z.string().describe('The other team, as written.'),
    home: z.enum(['home', 'away', 'unknown']).describe('Whether our team is the home team.'),
    venue: z.string().describe('Field or park name, or empty.'),
    address: z.string().describe('Street address or city if given, or empty.'),
    note: z.string().describe('Anything else worth knowing (bracket, pool play, "TBD"), or empty.'),
  })),
  unsure: z.array(z.string()).describe('Games or details that could not be read for certain.'),
});
export type ScheduleRead = z.infer<typeof ScheduleRead>;
export type Found = ScheduleRead['games'][number];

export const SCHEDULE_SYSTEM = `You pick one youth baseball team's games out of a schedule: a tournament email, a league web page's text, or a coach's message.
- Return only games our team plays in. A tournament page lists many teams: match ours by its name, short name or abbreviation, allowing small differences ("Blue Steel 14U", "Blue Steel Baseball").
- Dates as YYYY-MM-DD. If the year is not written, use the next date on or after today that fits. Times as 24-hour HH:MM, local to the schedule; empty if none is given or it says TBD.
- Opponent exactly as written. If the opponent is not decided yet ("Winner of Game 4"), write that as the opponent and say so in "note".
- home: "home" if our team is listed as home (often the second team, or "vs"), "away" if listed as visitor (first team, or "@"/"at"), else "unknown".
- Never invent a game, a time or a field. Anything uncertain goes in "unsure".`;

export const schedulePrompt = (team: string[], today: string, text: string) =>
  `Our team: ${team.filter(Boolean).join(' / ')}\nToday: ${today}\n\n<schedule>\n${text}\n</schedule>`;

// A local date and time in the team's zone as an instant: "2026-10-17", "09:45" -> ISO.
export function localToIso(date: string, time: string, tz = TZ): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!d) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || '12:00');
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  const guess = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  // The zone's offset at that moment, read back from Intl; twice, for the day the clocks change.
  const offset = (ms: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - ms;
  };
  let ms = guess - offset(guess);
  ms = guess - offset(ms);
  return new Date(ms).toISOString();
}

export function checkSchedule(r: ScheduleRead, now = Date.now()): string[] {
  const problems: string[] = [];
  for (const g of r.games) {
    const iso = localToIso(g.date, g.time || '12:00');
    if (!iso) { problems.push(`"${g.date} ${g.time}" is not a date and time.`); continue; }
    const days = (Date.parse(iso) - now) / 86400000;
    if (days < -60 || days > 400) problems.push(`${g.date} is far from today: check the year.`);
    if (!g.opponent.trim()) problems.push(`A game on ${g.date} has no opponent.`);
  }
  return problems;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// A found game already on the schedule: the same day (in the team's zone) and an opponent whose name overlaps.
export function alreadyThere(f: Found, existing: { starts_at: string | null; opponent_name: string }[], tz = TZ) {
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  const a = norm(f.opponent);
  return existing.some((g) => g.starts_at && day(g.starts_at) === f.date &&
    (norm(g.opponent_name).includes(a) || a.includes(norm(g.opponent_name)) || norm(g.opponent_name).split(' ')[0] === a.split(' ')[0]));
}

// A web page's text: no scripts, styles or tags, entities decoded, at most 60k characters.
export function pageText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim().slice(0, 60000);
}
