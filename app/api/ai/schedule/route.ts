// POST /api/ai/schedule { teamId, text?, url? }: pick this team's games out of
// a pasted schedule or a tournament page. Nothing is saved here: the import
// page lists what was found, and the coach ticks which to add.
import { NextResponse } from 'next/server';
import { aiWrite, fail, seat } from '@/lib/ai-call';
import { fetchPublicPage } from '@/lib/safe-fetch';
import { alreadyThere, checkSchedule, localToIso, pageText, SCHEDULE_MODEL, SCHEDULE_SYSTEM, schedulePrompt, scheduleNotes, ScheduleRead, TZ } from '@/lib/schedule-import';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';

export const maxDuration = 60;

async function fetchPage(raw: string): Promise<string | { error: string }> {
  const page = await fetchPublicPage(raw);
  if (typeof page !== 'string') return { error: `${page.error} Paste the page's text instead.` };
  const text = pageText(page);
  return text.length > 40 ? text : { error: 'That page has almost no text (it may draw its schedule with scripts). Paste its text instead.' };
}

export async function POST(req: Request) {
  if (!supabaseConfigured) return fail(503, 'The database is not set up.');
  const body = (await req.json().catch(() => ({}))) as { teamId?: string; text?: string; url?: string };
  if (!body.teamId || !/^[0-9a-f-]{36}$/i.test(body.teamId)) return fail(400, 'Which team?');
  const db = await createClient();
  const who = await seat(db, body.teamId, ['organizer', 'head_coach', 'coach']);
  if ('error' in who) return who.error;

  let text = (body.text ?? '').trim().slice(0, 60000);
  if (!text && body.url) {
    const page = await fetchPage(body.url.trim());
    if (typeof page !== 'string') return fail(400, page.error);
    text = page;
  }
  if (text.length < 10) return fail(400, 'Paste the schedule, or a link to it.');

  const { data: team } = await db.from('teams').select('name, display_name, abbr').eq('id', body.teamId).single<{ name: string; display_name: string; abbr: string }>();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  const r = await aiWrite({
    db, teamId: body.teamId, kind: 'schedule', model: SCHEDULE_MODEL, system: SCHEDULE_SYSTEM, schema: ScheduleRead,
    effort: 'low', content: schedulePrompt([team?.display_name ?? '', team?.name ?? '', team?.abbr ?? ''], today, text), check: (x) => checkSchedule(x),
  });
  if ('error' in r) return r.error;
  const { data: existing } = await db.from('games').select('starts_at, opponent_name').eq('team_id', body.teamId);
  // A game with no time given keeps none: the coach types it before it can be added.
  const games = r.out.games
    .filter((g) => localToIso(g.date, '12:00'))
    .map((g) => ({ ...g, starts_at: g.time ? localToIso(g.date, g.time) : null, dup: alreadyThere(g, existing ?? []) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return NextResponse.json({ games, unsure: [...r.out.unsure, ...scheduleNotes(r.out), ...r.warnings] });
}
