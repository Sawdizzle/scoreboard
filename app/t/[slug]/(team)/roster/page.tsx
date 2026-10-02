import type { Metadata } from 'next';
import { RosterView } from '@/components/views/RosterView';
import { listPlayers, loadTeam } from '@/lib/data';

export const metadata: Metadata = { title: 'Roster' };

export default async function Roster({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  return <RosterView team={team} role={role} players={await listPlayers(supabase, team.id)} />;
}
