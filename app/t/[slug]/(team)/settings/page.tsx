import type { Metadata } from 'next';
import { SettingsView } from '@/components/views/SettingsView';
import { loadTeam } from '@/lib/data';
import { origin } from '@/lib/origin';

export const metadata: Metadata = { title: 'Team look' };

export default async function Settings({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ new?: string }>;
}) {
  const { slug } = await params;
  const { team, role } = await loadTeam(slug);
  return <SettingsView team={team} role={role} welcome={(await searchParams).new === '1'} publicUrl={`${await origin()}/team/${team.slug}`} />;
}
