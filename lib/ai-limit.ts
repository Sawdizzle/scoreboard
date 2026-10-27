// A team's AI writes this month: its limit (its plan; 0 is AI off), what it
// has used and what is left. ai_allowance() in the database counts them; this
// turns the answer into what a coach reads.
import type { SupabaseClient } from '@supabase/supabase-js';

export type Allowance = { limit: number; used: number; remaining: number; resets: string };

export async function getAllowance(db: SupabaseClient, teamId: string): Promise<Allowance | null> {
  const { data, error } = await db.rpc('ai_allowance', { p_team: teamId });
  return error || !data ? null : (data as Allowance);
}

export const aiOn = (a: Allowance | null) => !!a && a.limit > 0;

const monthDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'America/Chicago' });
const monthOf = (iso: string) => new Date(Date.parse(iso) - 86400000).toLocaleDateString('en-US', { month: 'long', timeZone: 'America/Chicago' });

// Why a write is refused, or null when it may go ahead.
export function refusal(a: Allowance | null): { status: number; error: string } | null {
  if (!aiOn(a)) return { status: 403, error: 'AI writing is off for this team.' };
  if (a!.remaining <= 0) {
    return { status: 429, error: `Your team has used its ${a!.limit} AI writes for ${monthOf(a!.resets)}. They reset ${monthDay(a!.resets)}.` };
  }
  return null;
}

// Take one of this month's writes before calling Claude, so two taps at once
// cannot both slip under the limit; settle it with what the call used.
export async function reserve(db: SupabaseClient, teamId: string, gameId: string | null, kind: string, model: string):
  Promise<{ id: number } | { status: number; error: string }> {
  const { data, error } = await db.rpc('ai_reserve', { p_team: teamId, p_game: gameId, p_kind: kind, p_model: model });
  if (error || !data) return { status: 403, error: 'Your seat on this team cannot use AI writing.' };
  const r = data as { id: number | null; limit: number; used: number; resets: string };
  if (r.id) return { id: r.id };
  return refusal({ limit: r.limit, used: r.used, remaining: 0, resets: r.resets }) ?? { status: 429, error: 'No AI writes left this month.' };
}
// Settling is the server's job (the secret key's client): a signed-in user
// cannot touch it. Without the key the reservation simply stays as it is,
// counted either way, with its tokens unrecorded.
export async function settle(db: SupabaseClient | null, id: number, model: string, tokensIn: number, tokensOut: number, ok: boolean) {
  if (!db) return;
  await db.rpc('ai_settle', { p_id: id, p_model: model, p_in: tokensIn, p_out: tokensOut, p_ok: ok });
}
