import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GameView } from '@/components/views/GameView';
import type { RecapRow } from '@/components/RecapCard';
import { aiOn, getAllowance } from '@/lib/ai-limit';
import { auditGame } from '@/lib/audit';
import type { SummaryEvent, SummaryStat } from '@/lib/summarize';
import { viewClips } from '@/lib/clips';
import { getGame, getLineups, listGameScorers, listSeasons, listStaff, loadTeam } from '@/lib/data';
import { ScorersCard } from '@/components/hub/ScorersCard';
import { loadClips, streamStartFor } from '@/lib/game-facts';

export const metadata: Metadata = { title: 'Game' };

export default async function GamePage({ params }: { params: Promise<{ slug: string; gameId: string }> }) {
  const { slug, gameId } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const game = await getGame(supabase, team.id, gameId);
  if (!game) notFound();
  const [lineups, seasons, { data: recap }, allowance] = await Promise.all([getLineups(supabase, game.id), listSeasons(supabase, team.id),
    supabase.from('game_recaps').select('status, content, content_es, warnings, model, generated_at, edited_at, published_at').eq('game_id', game.id).maybeSingle<RecapRow>(),
    getAllowance(supabase, team.id)]);
  // A final game's scoring check, the same one End game ran on the pad.
  let issues = null;
  if (game.status === 'final' && game.sport === 'baseball') {
    const [{ data: events }, { data: stats }] = await Promise.all([
      supabase.from('game_events').select('id, seq, type, payload, prev_live').eq('game_id', game.id).order('seq'),
      supabase.from('game_stats').select('event_id, side, bid, b_pa, b_h, b_r, p_bf, p_outs, p_pitches').eq('game_id', game.id),
    ]);
    const season = seasons.find((x) => x.id === game.season_id);
    issues = auditGame({
      game: { is_home: game.is_home, status: game.status, live: game.live as Record<string, unknown>, sport: game.sport },
      teams: { us: team.display_name || team.name, them: game.opponent_name },
      events: (events ?? []) as SummaryEvent[], stats: (stats ?? []) as SummaryStat[], lineups,
      regulationInnings: game.settings?.regulation ?? season?.game_innings ?? null, runRule: game.settings?.run_rule ?? null,
    });
  }
  // The stream's replay-buffer saves for this game (staff only, by RLS), placed in the stream.
  const rows = await loadClips(supabase, game.id);
  const streamStart = rows.length ? await streamStartFor(supabase, team.id, rows[0].moment_at) : null;
  const clips = rows.length ? { list: viewClips(rows, streamStart), streamStart } : null;
  const [staff, scorers] = await Promise.all([listStaff(supabase, team.id), listGameScorers(supabase, [game.id])]);
  return (
    <>
      <GameView team={team} role={role} game={game} lineups={lineups} seasons={seasons} recap={recap} ai={aiOn(allowance)} issues={issues} clips={clips} />
      <div className="page"><ScorersCard slug={slug} gameId={game.id} role={role} staff={staff} scorers={scorers[game.id] ?? []} /></div>
    </>
  );
}
