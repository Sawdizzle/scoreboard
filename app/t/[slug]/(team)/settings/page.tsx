import type { Metadata } from 'next';
import { SettingsView } from '@/components/views/SettingsView';
import { loadTeam } from '@/lib/data';
import { origin } from '@/lib/origin';

export const metadata: Metadata = { title: 'Team look' };

export default async function Settings({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ new?: string }>;
}) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const { data: channel } = await supabase.from('channels').select('token').eq('team_id', team.id).maybeSingle<{ token: string }>();
  return <SettingsView team={team} role={role} welcome={(await searchParams).new === '1'}
    streamUrl={channel ? `${await origin()}/overlay/${channel.token}` : undefined} />;
}
