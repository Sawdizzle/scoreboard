import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Pad } from '@/components/pad/Pad';
import { ScorePad } from '@/components/pad/ScorePad';
import { getGame, getLineups, listPlayers, listSeasons, loadTeam, seasonStats } from '@/lib/data';
import { batterOf, withRosterNames } from '@/lib/lineup';
import { byJersey } from '@/lib/format';
import type { Channel } from '@/components/pad/OnAir';
import { CHANNEL_COLS } from '@/lib/broadcast';
import type { StatRow } from '@/lib/scoring';
import { canEditTeam, canRunGames, canWriteRecaps, type Game } from '@/lib/types';
import { aiOn, getAllowance } from '@/lib/ai-limit';

export const metadata: Metadata = { title: 'Pad' };

// The pad is its own full screen: no team header, no tab bar, nothing to hit
// by mistake with a thumb while the pitcher is in his windup.
export default async function PadPage({ params, searchParams }: { params: Promise<{ slug: string; gameId: string }>; searchParams: Promise<{ end?: string }> }) {
  const { slug, gameId } = await params;
  // ?end=1 (Today's "End it on the pad"): the pad opens on End game.
  const openEnd = (await searchParams).end === '1';
  const { supabase, team, role } = await loadTeam(slug);
  const game = await getGame(supabase, team.id, gameId);
  if (!game) notFound();
  const [lineups, seasons, seqRow, stats, players] = await Promise.all([
    getLineups(supabase, game.id),
    listSeasons(supabase, team.id),
    supabase.from('games').select('seq').eq('id', game.id).single(),
    supabase.from('game_stats').select('*').eq('game_id', game.id),
    listPlayers(supabase, team.id),
  ]);
  // Our batters under the team's name format, whatever it was when the lineup was saved.
  if (lineups.us) lineups.us = withRosterNames(lineups.us, players, team.name_format);
  const season = seasons.find((s) => s.id === game.season_id) ?? seasons.find((s) => s.is_current);
  const lines = season ? await seasonStats(supabase, team.id, season.id) : [];
  // Before the Stage 3 migration there is no channel; the pad then has no On Air.
  const { data: channel } = await supabase.from('channels').select(CHANNEL_COLS).eq('team_id', team.id).maybeSingle<Channel>();
  // The blurb button: coaches, and only when the team's plan has AI on.
  const canWrite = canWriteRecaps(role) && aiOn(await getAllowance(supabase, team.id));
  if (game.sport !== 'baseball') {
    return <ScorePad slug={slug} team={team} game={{ ...(game as Game), seq: (seqRow.data as { seq: number } | null)?.seq ?? 0 }}
      canScore={canRunGames(role)} canWrite={canWrite} channel={channel ?? null} />;
  }
  return (
    <Pad slug={slug} team={team} game={{ ...(game as Game), seq: (seqRow.data as { seq: number } | null)?.seq ?? 0 }}
      lineups={lineups} season={lines} tonightRows={(stats.data ?? []) as StatRow[]}
      regulation={season?.game_innings ?? 7} canScore={canRunGames(role)} canWrite={canWrite} channel={channel ?? null}
      roster={players.map((p) => ({ id: p.id, first_name: p.first_name, last_name: p.last_name }))}
      bench={players.filter((p) => p.active).sort(byJersey).map((p) => batterOf(p, team.name_format))} canRoster={canEditTeam(role)} openEnd={openEnd} />
  );
}
