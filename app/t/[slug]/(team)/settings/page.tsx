import type { Metadata } from 'next';
import { SettingsView } from '@/components/views/SettingsView';
import { loadTeam } from '@/lib/data';

export const metadata: Metadata = { title: 'Team' };

export default async function Settings({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { team, role } = await loadTeam(slug);
  return <SettingsView team={team} role={role} />;
}
