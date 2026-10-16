// POST /api/ai/blurb { gameId }: write a pregame blurb for Starting Soon and
// hand it back for the operator to check. Nothing is saved and nothing goes to
// the stream here: the pad's Use button does that, through set_broadcast.
// Runs as the signed-in coach; the Anthropic key never leaves the server.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { NextResponse } from 'next/server';
import { BLURB_MODEL, BLURB_SYSTEM, BlurbContent, blurbPrompt, checkBlurb, matchupFacts, type PastGame } from '@/lib/blurb';
import type { PublicGame } from '@/lib/public';
import { getAllowance, refusal } from '@/lib/ai-limit';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';

export const maxDuration = 60;

const WRITERS = new Set(['organizer', 'head_coach', 'coach']);
const GAME_COLS = 'id, team_id, starts_at, is_home, status, counts_for_stats, season_id, opponent_id, opponent_team_id, opponent_name, sport, live, venue';
const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  if (!supabaseConfigured) return fail(503, 'The database is not set up.');
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return fail(503, 'Blurbs are not switched on here yet (no ANTHROPIC_API_KEY).');
  const { gameId } = (await req.json().catch(() => ({}))) as { gameId?: string };
  if (!gameId || !/^[0-9a-f-]{36}$/i.test(gameId)) return fail(400, 'Which game?');

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return fail(401, 'Sign in first.');

  const { data: game } = await supabase.from('games').select(GAME_COLS).eq('id', gameId)
    .maybeSingle<PastGame & { team_id: string; venue: string | null }>();
  if (!game) return fail(404, 'No such game.');
  const { data: seat } = await supabase.from('team_staff').select('role').eq('team_id', game.team_id).eq('user_id', userId).maybeSingle<{ role: string }>();
  if (!seat || !WRITERS.has(seat.role)) return fail(403, 'Only organizers and coaches write blurbs.');
  if (game.status === 'final') return fail(409, 'This game is over: blurbs are for before the first pitch.');
  // The team's plan: AI off, or this month's writes used up. Checked before any call goes out.
  const no = refusal(await getAllowance(supabase, game.team_id));
  if (no) return fail(no.status, no.error);

  const [{ data: pub }, { data: games }] = await Promise.all([
    supabase.rpc('public_game', { p_game: game.id }),
    supabase.from('games').select(GAME_COLS).eq('team_id', game.team_id).eq('status', 'final'),
  ]);
  const p = pub as PublicGame | null;
  if (!p) return fail(404, 'No such game.');
  const facts = matchupFacts({
    game, games: (games ?? []) as PastGame[],
    teams: { us: p.team.display_name || p.team.name, them: p.opponent.display_name || p.opponent.name },
    venue: game.venue, season: p.season?.name ?? null,
  });

  const client = new Anthropic({ apiKey });
  const prompt = blurbPrompt(facts);
  let blurb: BlurbContent | null = null;
  let problems: string[] = [];
  let tokensIn = 0, tokensOut = 0, model = BLURB_MODEL;
  const log = (ok: boolean) => supabase.from('ai_usage').insert({
    team_id: game.team_id, game_id: game.id, kind: 'blurb', model, input_tokens: tokensIn, output_tokens: tokensOut, ok });
  const write = (ask: string) => client.messages.parse({
    model: BLURB_MODEL,
    max_tokens: 4000,
    system: BLURB_SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(BlurbContent) },
    messages: [{ role: 'user', content: ask }],
  });

  try {
    // One try, and one fresh retry carrying what the check found.
    for (let attempt = 0; attempt < 2; attempt++) {
      const ask: string = attempt === 0 || !blurb ? prompt
        : `${prompt}\n\nA first draft did not fit:\n- ${problems.join('\n- ')}\n\n<first_draft>\n${JSON.stringify(blurb)}\n</first_draft>\n\nWrite it again, fixing these.`;
      const res: Awaited<ReturnType<typeof write>> = await write(ask);
      tokensIn += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
      tokensOut += res.usage.output_tokens;
      model = res.model;
      if (res.stop_reason === 'refusal' || !res.parsed_output) {
        problems = [res.stop_reason === 'refusal' ? 'The writer declined this one.' : 'The answer came back incomplete.'];
        continue;
      }
      const out: BlurbContent = res.parsed_output;
      blurb = out;
      problems = checkBlurb(out, facts);
      if (!problems.length) break;
    }
  } catch (e) {
    await log(false);
    if (e instanceof Anthropic.APIError) console.error('blurb: Anthropic', e.status, e.requestID ?? '', e.message);
    if (e instanceof Anthropic.AuthenticationError) return fail(502, 'The Anthropic key was refused (401). Check ANTHROPIC_API_KEY in Vercel.');
    if (e instanceof Anthropic.RateLimitError) return fail(429, 'The writer is busy. Try again in a minute.');
    if (e instanceof Anthropic.APIError) return fail(502, `The writer failed (${e.status ?? 'network'}). Try again.`);
    throw e;
  }
  await log(!!blurb);
  if (!blurb) return fail(502, problems[0] ?? 'No blurb came back. Try again.');
  return NextResponse.json({ blurb, warnings: problems, facts });
}
