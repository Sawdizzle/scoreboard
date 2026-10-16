// One AI write, the way every helper after recaps does it: check the team's
// allowance and seat, ask Claude for a structured answer, hold it to a check,
// retry once with what the check found, and log the call to ai_usage. Server
// only: the Anthropic key never leaves the server.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { getAllowance, refusal, reserve, settle } from './ai-limit';
import { createClient } from './supabase/server';

export type Kind = 'recap' | 'blurb' | 'lineup' | 'schedule' | 'ask' | 'card' | 'youtube' | 'translate';
export type Db = Awaited<ReturnType<typeof createClient>>;
export const fail = (status: number, error: string) => NextResponse.json({ error }, { status });

// The signed-in user's seat on a team, or a response saying why not.
export async function seat(db: Db, teamId: string, roles: string[]) {
  const { data: claims } = await db.auth.getClaims();
  const userId = claims?.claims?.sub as string | undefined;
  if (!userId) return { error: fail(401, 'Sign in first.') };
  const { data } = await db.from('team_staff').select('role').eq('team_id', teamId).eq('user_id', userId).maybeSingle<{ role: string }>();
  if (!data || !roles.includes(data.role)) return { error: fail(403, 'Your seat on this team cannot do that.') };
  const no = refusal(await getAllowance(db, teamId));
  if (no) return { error: fail(no.status, no.error) };
  return { userId, role: data.role };
}

type Content = string | Anthropic.Beta.BetaContentBlockParam[];
export async function aiWrite<S extends z.ZodType>(o: {
  db: Db; teamId: string; gameId?: string | null; kind: Kind;
  model: string; system: string; content: Content; schema: S;
  effort?: 'low' | 'medium' | 'high'; maxTokens?: number;
  check?: (out: z.infer<S>) => string[];
}): Promise<{ out: z.infer<S>; warnings: string[]; model: string } | { error: NextResponse }> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { error: fail(503, 'AI is not switched on here yet (no ANTHROPIC_API_KEY).') };
  const client = new Anthropic({ apiKey });
  // Sonnet and Opus fall back server-side on a refusal; Haiku has no fallback.
  const fallback = !o.model.includes('haiku');
  let out: z.infer<S> | null = null;
  let problems: string[] = [];
  let tokensIn = 0, tokensOut = 0, model = o.model;
  const held = await reserve(o.db, o.teamId, o.gameId ?? null, o.kind, o.model);
  if ('error' in held) return { error: fail(held.status, held.error) };
  const log = (ok: boolean) => settle(o.db, held.id, model, tokensIn, tokensOut, ok);

  try {
    for (let attempt = 0; attempt < (o.check ? 2 : 1); attempt++) {
      // The retry is a fresh request carrying the first answer, not a second turn.
      const retry = attempt > 0 && out
        ? `\n\nA first answer did not hold up:\n- ${problems.join('\n- ')}\n\n<first_answer>\n${JSON.stringify(out)}\n</first_answer>\n\nAnswer again, fixing these.`
        : '';
      const content: Content = typeof o.content === 'string' ? o.content + retry
        : retry ? [...o.content, { type: 'text', text: retry }] : o.content;
      const res = await client.beta.messages.parse({
        model: o.model,
        max_tokens: o.maxTokens ?? 8000,
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: o.effort ?? 'medium', format: betaZodOutputFormat(o.schema) },
        messages: [{ role: 'user', content }],
      });
      tokensIn += res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0);
      tokensOut += res.usage.output_tokens;
      model = res.model;
      if (res.stop_reason === 'refusal' || !res.parsed_output) {
        problems = [res.stop_reason === 'refusal' ? 'The writer declined this one.' : 'The answer came back incomplete.'];
        continue;
      }
      out = res.parsed_output as z.infer<S>;
      problems = o.check ? o.check(out) : [];
      if (!problems.length) break;
    }
  } catch (e) {
    await log(false);
    if (e instanceof Anthropic.APIError) console.error(`ai ${o.kind}: Anthropic`, e.status, e.requestID ?? '', e.message);
    if (e instanceof Anthropic.AuthenticationError) return { error: fail(502, 'The Anthropic key was refused (401). Check ANTHROPIC_API_KEY in Vercel.') };
    if (e instanceof Anthropic.RateLimitError) return { error: fail(429, 'The AI is busy. Try again in a minute.') };
    if (e instanceof Anthropic.BadRequestError) return { error: fail(400, 'The AI could not read that. Try a clearer photo or less text.') };
    if (e instanceof Anthropic.APIError) return { error: fail(502, `The AI failed (${e.status ?? 'network'}). Try again.`) };
    throw e;
  }
  await log(!!out);
  if (!out) return { error: fail(502, problems[0] ?? 'Nothing came back. Try again.') };
  return { out, warnings: problems, model };
}
