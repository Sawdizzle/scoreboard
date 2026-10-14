import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Pad } from '@/components/pad/Pad';
import { ScorePad } from '@/components/pad/ScorePad';
import { getGame, getLineups, listSeasons, loadTeam, seasonStats } from '@/lib/data';
import type { Channel } from '@/components/pad/OnAir';
import { CHANNEL_COLS } from '@/lib/broadcast';
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
  // Before the Stage 3 migration there is no channel; the pad then has no On Air.
  const { data: channel } = await supabase.from('channels').select(CHANNEL_COLS).eq('team_id', team.id).maybeSingle<Channel>();
  if (game.sport !== 'baseball') {
    return <ScorePad slug={slug} team={team} game={{ ...(game as Game), seq: (seqRow.data as { seq: number } | null)?.seq ?? 0 }}
      canScore={canRunGames(role)} channel={channel ?? null} />;
  }
  return (
    <Pad slug={slug} team={team} game={{ ...(game as Game), seq: (seqRow.data as { seq: number } | null)?.seq ?? 0 }}
      lineups={lineups} season={lines} tonightRows={(stats.data ?? []) as StatRow[]}
      regulation={season?.game_innings ?? 7} canScore={canRunGames(role)} channel={channel ?? null} />
  );
}
