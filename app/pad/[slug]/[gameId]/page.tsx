import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Pad } from '@/components/pad/Pad';
import { getGame, getLineups, listSeasons, loadTeam, seasonStats } from '@/lib/data';
import { batting, rate3 } from '@/lib/stats';
import type { StatRow } from '@/lib/scoring';
import { canRunGames, type Game } from '@/lib/types';

export const metadata: Metadata = { title: 'Pad' };

// The pad is its own full screen: no team header, no tab bar, nothing to hit
// by mistake with a thumb while the pitcher is in his windup.
export default async function PadPage({ params }: { params: Promise<{ slug: string; gameId: string }> }) {
  const { slug, gameId } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const game = await getGame(supabase, team.id, gameId);
  if (!game) notFound();
  const [lineups, seasons, seqRow, stats] = await Promise.all([
    getLineups(supabase, game.id),
    listSeasons(supabase, team.id),
    supabase.from('games').select('seq').eq('id', game.id).single(),
    supabase.from('game_stats').select('*').eq('game_id', game.id),
  ]);
  const season = seasons.find((s) => s.id === game.season_id) ?? seasons.find((s) => s.is_current);
  const lines = season ? await seasonStats(supabase, team.id, season.id) : [];
  const seasonAvg = Object.fromEntries(lines.filter((l) => l.b_pa > 0).map((l) => [l.player_id, rate3(batting(l).avg)]));
  return (
    <Pad slug={slug} team={team} game={{ ...(game as Game), seq: (seqRow.data as { seq: number } | null)?.seq ?? 0 }}
      lineups={lineups} seasonAvg={seasonAvg} tonightRows={(stats.data ?? []) as StatRow[]}
      regulation={season?.game_innings ?? 7} canScore={canRunGames(role)} />
  );
}
