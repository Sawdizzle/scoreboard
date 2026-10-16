// POST /api/ai/recap { gameId }: write a final game's content pack and save it
// as a draft. Runs as the signed-in coach, so Row Level Security decides what
// it may read and write; the Anthropic key never leaves the server. Nothing
// here is on the stream's path: the overlay and the pad never call it.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { NextResponse } from 'next/server';
import { checkRecap, RECAP_MODEL, RECAP_SYSTEM, recapPrompt, RecapContent, type RecapContext } from '@/lib/recap';
import { getAllowance, refusal, reserve, settle } from '@/lib/ai-limit';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import { gameDate, getGameRow, loadFacts } from '@/lib/game-facts';

export const maxDuration = 90;

const WRITERS = new Set(['organizer', 'head_coach', 'coach']);
const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  if (!supabaseConfigured) return fail(503, 'The database is not set up.');
  // Trimmed: a key pasted into the dashboard with a stray newline is refused as a bad key.
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return fail(503, 'Recaps are not switched on here yet (no ANTHROPIC_API_KEY).');
  const { gameId } = (await req.json().catch(() => ({}))) as { gameId?: string };
  if (!gameId || !/^[0-9a-f-]{36}$/i.test(gameId)) return fail(400, 'Which game?');

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return fail(401, 'Sign in first.');

  const game = await getGameRow(supabase, gameId);
  if (!game) return fail(404, 'No such game.');
  const { data: seat } = await supabase.from('team_staff').select('role').eq('team_id', game.team_id).eq('user_id', userId).maybeSingle<{ role: string }>();
  if (!seat || !WRITERS.has(seat.role)) return fail(403, 'Only organizers and coaches write recaps.');
  if (game.status !== 'final') return fail(409, 'End the game first: recaps are written for final games.');
  // The team's plan: AI off, or this month's writes used up. Checked before any call goes out.
  const no = refusal(await getAllowance(supabase, game.team_id));
  if (no) return fail(no.status, no.error);

  // The public view of the game gives the lineups under each player's public
  // name, the team names and the season; the log and the stats come as staff.
  const loaded = await loadFacts(supabase, game);
  if (!loaded) return fail(404, 'No such game.');
  const { facts, pub: p } = loaded;
  const ctx: RecapContext = {
    team: facts.teams.us, opponent: facts.teams.them,
    date: gameDate(game.starts_at),
    venue: game.venue, season: p.season?.name ?? null, ageGroup: p.team.age_group,
  };

  const client = new Anthropic({ apiKey });
  const prompt = recapPrompt(facts, ctx);
  let content: RecapContent | null = null;
  let problems: string[] = [];
  let tokensIn = 0, tokensOut = 0, model = RECAP_MODEL;
  // One of this month's writes, taken before the call so the limit holds.
  const held = await reserve(supabase, game.team_id, game.id, 'recap', RECAP_MODEL);
  if ('error' in held) return fail(held.status, held.error);
  const log = (ok: boolean) => settle(supabase, held.id, model, tokensIn, tokensOut, ok);

  const parse = (ask: string) => client.beta.messages.parse({
    model: RECAP_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: RECAP_SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: betaZodOutputFormat(RecapContent) },
    messages: [{ role: 'user', content: ask }],
  });

  try {
    // One try, and one retry with what the fact check found. The retry is a
    // fresh request carrying the first answer, not a second turn.
    for (let attempt = 0; attempt < 2; attempt++) {
      const ask: string = attempt === 0 || !content ? prompt : `${prompt}

A first draft of this pack did not match the facts:
- ${problems.join('\n- ')}

<first_draft>
${JSON.stringify(content)}
</first_draft>

Write the whole pack again, fixing these and keeping what was right.`;
      const res: Awaited<ReturnType<typeof parse>> = await parse(ask);
      tokensIn += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
      tokensOut += res.usage.output_tokens;
      model = res.model;
      if (res.stop_reason === 'refusal' || !res.parsed_output) {
        problems = [res.stop_reason === 'refusal' ? 'The writer declined this game.' : 'The answer came back incomplete.'];
        continue;
      }
      const out: RecapContent = res.parsed_output;
      content = out;
      problems = checkRecap(out, facts);
      if (!problems.length) break;
    }
  } catch (e) {
    await log(false);
    if (e instanceof Anthropic.APIError) console.error('recap: Anthropic', e.status, e.requestID ?? '', e.message);
    if (e instanceof Anthropic.AuthenticationError) return fail(502, 'The Anthropic key was refused (401). Check ANTHROPIC_API_KEY in Vercel.');
    if (e instanceof Anthropic.PermissionDeniedError) return fail(502, 'The Anthropic key cannot use this model (403). Check the key’s workspace in the Anthropic Console.');
    if (e instanceof Anthropic.RateLimitError) return fail(429, 'The writer is busy. Try again in a minute.');
    if (e instanceof Anthropic.APIError) return fail(502, `The writer failed (${e.status ?? 'network'}). Try again.`);
    throw e;
  }
  await log(!!content);
  if (!content) return fail(502, problems[0] ?? 'No recap came back. Try again.');

  // A new draft replaces the old one, published or not: the coach publishes again.
  const row = { status: 'draft', content, facts, warnings: problems, model,
    generated_at: new Date().toISOString(), edited_at: null, published_at: null };
  const { data: had } = await supabase.from('game_recaps').select('game_id').eq('game_id', game.id).maybeSingle();
  const { error } = had
    ? await supabase.from('game_recaps').update({ ...row, updated_by: userId }).eq('game_id', game.id)
    : await supabase.from('game_recaps').insert({ ...row, game_id: game.id, team_id: game.team_id });
  if (error) return fail(500, `Could not save the recap: ${error.message}`);
  return NextResponse.json({ content, warnings: problems, model, generated_at: row.generated_at });
}
