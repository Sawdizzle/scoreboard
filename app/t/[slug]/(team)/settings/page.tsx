import type { Metadata } from 'next';
import { SettingsView } from '@/components/views/SettingsView';
import type { UsageRow } from '@/components/AiUsageCard';
import { getAllowance } from '@/lib/ai-limit';
import { loadTeam } from '@/lib/data';
import { canWriteRecaps } from '@/lib/types';
import { origin } from '@/lib/origin';

export const metadata: Metadata = { title: 'Team look' };

export default async function Settings({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ new?: string }>;
}) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const ai = canWriteRecaps(role) ? await Promise.all([
    getAllowance(supabase, team.id),
    supabase.from('ai_usage').select('created_at, kind, model, input_tokens, output_tokens, ok, games(opponent_name, starts_at)')
      .eq('team_id', team.id).order('id', { ascending: false }).limit(20),
  ]).then(([allowance, { data }]) => ({ allowance, rows: (data ?? []) as unknown as UsageRow[] })) : null;
  return <SettingsView team={team} role={role} welcome={(await searchParams).new === '1'} publicUrl={`${await origin()}/team/${team.slug}`} ai={ai} />;
}
