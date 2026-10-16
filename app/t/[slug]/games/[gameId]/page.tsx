import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GameView } from '@/components/views/GameView';
import type { RecapRow } from '@/components/RecapCard';
import { aiOn, getAllowance } from '@/lib/ai-limit';
import { getGame, getLineups, listSeasons, loadTeam } from '@/lib/data';

export const metadata: Metadata = { title: 'Game' };

export default async function GamePage({ params }: { params: Promise<{ slug: string; gameId: string }> }) {
  const { slug, gameId } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const game = await getGame(supabase, team.id, gameId);
  if (!game) notFound();
  const [lineups, seasons, { data: recap }, allowance] = await Promise.all([getLineups(supabase, game.id), listSeasons(supabase, team.id),
    supabase.from('game_recaps').select('status, content, warnings, model, generated_at, edited_at, published_at').eq('game_id', game.id).maybeSingle<RecapRow>(),
    getAllowance(supabase, team.id)]);
  return <GameView team={team} role={role} game={game} lineups={lineups} seasons={seasons} recap={recap} ai={aiOn(allowance)} />;
}
