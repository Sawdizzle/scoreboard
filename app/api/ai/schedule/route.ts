// POST /api/ai/schedule { teamId, text?, url? }: pick this team's games out of
// a pasted schedule or a tournament page. Nothing is saved here: the import
// page lists what was found, and the coach ticks which to add.
import { NextResponse } from 'next/server';
import { aiWrite, fail, seat } from '@/lib/ai-call';
import { alreadyThere, checkSchedule, localToIso, pageText, SCHEDULE_MODEL, SCHEDULE_SYSTEM, schedulePrompt, ScheduleRead, TZ } from '@/lib/schedule-import';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';

export const maxDuration = 60;

// A public web page's text. Only https, no bare addresses or local names, ten
// seconds and 2 MB at most.
async function fetchPage(raw: string): Promise<string | { error: string }> {
  let u: URL;
  try { u = new URL(raw); } catch { return { error: 'That link is not a web address.' }; }
  if (u.protocol !== 'https:' || /^(localhost|[\d.]+|\[.*\])$/i.test(u.hostname) || !u.hostname.includes('.') || /\.(local|internal|lan)$/i.test(u.hostname)) {
    return { error: 'Use a public https:// link, or paste the page’s text instead.' };
  }
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Scoreboard schedule import' }, redirect: 'follow' });
    if (!res.ok) return { error: `That page answered ${res.status}. Paste its text instead.` };
    const reader = res.body?.getReader();
    if (!reader) return { error: 'That page was empty.' };
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); break; }
      chunks.push(value);
    }
    const text = pageText(new TextDecoder().decode(Buffer.concat(chunks)));
    return text.length > 40 ? text : { error: 'That page has almost no text (it may draw its schedule with scripts). Paste its text instead.' };
  } catch {
    return { error: 'Could not open that page. Paste its text instead.' };
  }
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
  const games = r.out.games
    .map((g) => ({ ...g, starts_at: localToIso(g.date, g.time || '12:00'), dup: alreadyThere(g, existing ?? []) }))
    .filter((g) => g.starts_at)
    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!));
  return NextResponse.json({ games, unsure: [...r.out.unsure, ...r.warnings] });
}
