import type { Metadata } from 'next';
import { RosterView } from '@/components/views/RosterView';
import { listPlayers, listSeasons, loadTeam, seasonStats } from '@/lib/data';

export const metadata: Metadata = { title: 'Roster' };

export default async function Roster({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const [players, seasons] = await Promise.all([listPlayers(supabase, team.id), listSeasons(supabase, team.id)]);
  const current = seasons.find((x) => x.is_current);
  const stats = current ? await seasonStats(supabase, team.id, current.id) : [];
  return <RosterView team={team} role={role} players={players} stats={stats} />;
}
