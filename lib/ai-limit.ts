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
