import { TodayView } from '@/components/views/TodayView';
import { nextGame } from '@/components/GameBits';
import { getLineups, listGames, listPlayers, listSeasons, loadTeam, seasonStats } from '@/lib/data';

export default async function Today({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const [players, opps, seasons] = await Promise.all([
    supabase.from('players').select('id', { count: 'exact', head: true }).eq('team_id', team.id).eq('active', true),
    supabase.from('opponents').select('id', { count: 'exact', head: true }).eq('team_id', team.id),
    listSeasons(supabase, team.id),
  ]);
  const season = seasons.find((s) => s.is_current);
  const [stats, roster] = season ? await Promise.all([seasonStats(supabase, team.id, season.id), listPlayers(supabase, team.id)]) : [[], []];
  const game = nextGame(await listGames(supabase, team.id));
  const lineups = game ? await getLineups(supabase, game.id) : {};
  return <TodayView team={team} role={role} players={players.count ?? 0} opponents={opps.count ?? 0} season={season} stats={stats} roster={roster} game={game} lineups={lineups} />;
}
