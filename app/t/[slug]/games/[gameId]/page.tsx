import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GameView } from '@/components/views/GameView';
import { getGame, getLineups, listSeasons, loadTeam } from '@/lib/data';

export const metadata: Metadata = { title: 'Game' };

export default async function GamePage({ params }: { params: Promise<{ slug: string; gameId: string }> }) {
  const { slug, gameId } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const game = await getGame(supabase, team.id, gameId);
  if (!game) notFound();
  const [lineups, seasons] = await Promise.all([getLineups(supabase, game.id), listSeasons(supabase, team.id)]);
  return <GameView team={team} role={role} game={game} lineups={lineups} seasons={seasons} />;
}
