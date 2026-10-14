import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from '@/components/icons';
import { LineupEditor, type PoolPlayer } from '@/components/LineupEditor';
import { getGame, getLineups, lastLineup, listOpponents, listPlayers, listSeasons, loadTeam, publicRoster, seasonStats } from '@/lib/data';
import { byJersey, fullName } from '@/lib/format';
import { emptyLineup, lineupFromLast, lineupFromRoster } from '@/lib/lineup';
import { normalizeTeam } from '@/lib/rules/roster.js';
import { batting, rate3 } from '@/lib/stats';
import { canRunGames, type Lineup, type Side } from '@/lib/types';

export const metadata: Metadata = { title: 'Lineup' };

export default async function LineupPage({ params, searchParams }: {
  params: Promise<{ slug: string; gameId: string }>; searchParams: Promise<{ side?: string }>;
}) {
  const { slug, gameId } = await params;
  const side: Side = (await searchParams).side === 'them' ? 'them' : 'us';
  const { supabase, team, role } = await loadTeam(slug);
  const game = await getGame(supabase, team.id, gameId);
  if (!game) notFound();
  const saved = (await getLineups(supabase, game.id))[side];

  let pool: PoolPlayer[] = [];
  let initial: Lineup;
  const presets: { label: string; lineup: Lineup }[] = [];

  if (side === 'us') {
    const [players, seasons, last] = await Promise.all([listPlayers(supabase, team.id), listSeasons(supabase, team.id), lastLineup(supabase, team.id, game.id)]);
    const seasonId = game.season_id ?? seasons.find((s) => s.is_current)?.id;
    const stats = seasonId ? await seasonStats(supabase, team.id, seasonId) : [];
    const avg = new Map(stats.filter((s) => s.b_pa > 0).map((s) => [s.player_id, rate3(batting(s).avg)]));
    pool = players.filter((p) => p.active).sort(byJersey).map((p) => ({ bid: p.id, num: p.number, name: fullName(p), avg: avg.get(p.id) }));
    const fromLast = last ? lineupFromLast(last, players) : null;
    const fromRoster = lineupFromRoster(players);
    if (fromLast) presets.push({ label: 'Same as last game', lineup: fromLast });
    presets.push({ label: 'Whole roster, by number', lineup: fromRoster });
    initial = saved ?? fromLast ?? fromRoster;
  } else {
    if (game.opponent_team_id) {
      const theirs = await publicRoster(supabase, game.opponent_team_id);
      pool = theirs.map((p) => ({ bid: p.id, num: p.number, name: p.display_name ?? '' }));
      if (pool.length) presets.push({ label: 'Their whole roster', lineup: normalizeTeam({ batters: pool.map(({ bid, num, name }) => ({ bid, num, name })), positions: {} }) });
    } else if (game.opponent_id) {
      // An opponent from your list: their roster is the bench, and the whole of it a start.
      const opp = (await listOpponents(supabase, team.id)).find((o) => o.id === game.opponent_id);
      const roster = opp?.roster?.batters?.filter((b) => b.num || b.name) ?? [];
      pool = roster.map(({ bid, num, name }) => ({ bid, num, name }));
      if (roster.length) presets.push({ label: 'Their whole roster', lineup: normalizeTeam({ batters: roster, positions: opp?.roster?.positions ?? {} }) });
    }
    initial = saved ?? emptyLineup();
  }

  return (
    <div className="page" style={{ paddingTop: 6 }}>
      <div className="h-row" style={{ justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
        <Link href={`/t/${slug}/games/${game.id}`} aria-label="Back to the game" className="icon-btn" style={{ border: 0, marginLeft: -10 }}><ChevronLeft /></Link>
        <nav className="seg" aria-label="Side" style={{ flex: 1 }}>
          <Link href="?side=us" className="seg-item" aria-current={side === 'us' ? 'page' : undefined}>{team.display_name}</Link>
          <Link href="?side=them" className="seg-item" aria-current={side === 'them' ? 'page' : undefined}>{game.opponent?.display_name ?? game.opponent_name}</Link>
        </nav>
      </div>
      <LineupEditor key={side} slug={slug} gameId={game.id} side={side} initial={initial} stored={!!saved} pool={pool} presets={presets} canEdit={canRunGames(role)} />
    </div>
  );
}
