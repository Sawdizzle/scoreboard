import type { Metadata } from 'next';
import { SettingsView } from '@/components/views/SettingsView';
import { loadTeam } from '@/lib/data';
import type { Look } from '@/lib/onair';
import { origin } from '@/lib/origin';

export const metadata: Metadata = { title: 'Team look' };

export default async function Settings({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ new?: string }>;
}) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const { data: channel } = await supabase.from('channels').select('*').eq('team_id', team.id).maybeSingle<{ token: string; look?: Look }>();
  const at = await origin();
  return <SettingsView team={team} role={role} welcome={(await searchParams).new === '1'} publicUrl={`${at}/team/${team.slug}`}
    streamUrl={channel ? `${at}/overlay/${channel.token}` : undefined} look={channel?.look} />;
}
