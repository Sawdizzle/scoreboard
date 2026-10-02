import { notFound } from 'next/navigation';
import { PlayerView } from '@/components/views/PlayerView';
import { getPlayer, loadTeam } from '@/lib/data';

export default async function PlayerPage({ params }: { params: Promise<{ slug: string; playerId: string }> }) {
  const { slug, playerId } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  // A malformed id would be a database error rather than "no such player".
  if (!/^[0-9a-f-]{36}$/i.test(playerId)) notFound();
  const player = await getPlayer(supabase, team.id, playerId);
  if (!player) notFound();
  return <PlayerView team={team} role={role} player={player} />;
}
