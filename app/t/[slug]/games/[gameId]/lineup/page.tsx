import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LineupEditor, type PoolPlayer } from '@/components/LineupEditor';
import { getGame, getLineups, lastLineup, listOpponents, listPlayers, listSeasons, loadTeam, publicRoster, seasonStats } from '@/lib/data';
import { byJersey, formatName } from '@/lib/format';
import { emptyLineup, lineupFromLast, lineupFromRoster, withRosterNames } from '@/lib/lineup';
import { normalizeTeam } from '@/lib/rules/roster.js';
import { aiOn, getAllowance } from '@/lib/ai-limit';
import { batting, rate3 } from '@/lib/stats';
import { canEditTeam, canRunGames, type Lineup, type Side } from '@/lib/types';

export const metadata: Metadata = { title: 'Lineup' };

export default async function LineupPage({ params, searchParams }: {
  params: Promise<{ slug: string; gameId: string }>; searchParams: Promise<{ side?: string; from?: string }>;
}) {
  const { slug, gameId } = await params;
  const sp = await searchParams;
  const side: Side = sp.side === 'them' ? 'them' : 'us';
  // Opened from the pad: back (and on, once saved) goes to the pad.
  const fromPad = sp.from === 'pad';
  const { supabase, team, role } = await loadTeam(slug);
  const game = await getGame(supabase, team.id, gameId);
  if (!game) notFound();
  const saved = (await getLineups(supabase, game.id))[side];

  let pool: PoolPlayer[] = [];
  let initial: Lineup;
  const presets: { label: string; lineup: Lineup }[] = [];

  if (side === 'us') {
    const [players, seasons, last] = await Promise.all([listPlayers(supabase, team.id), listSeasons(supabase, team.id), lastLineup(supabase, team.id, game.id, game.starts_at)]);
    const seasonId = game.season_id ?? seasons.find((s) => s.is_current)?.id;
    const stats = seasonId ? await seasonStats(supabase, team.id, seasonId) : [];
    const avg = new Map(stats.filter((s) => s.b_pa > 0).map((s) => [s.player_id, rate3(batting(s).avg)]));
    pool = players.filter((p) => p.active).sort(byJersey).map((p) => ({ bid: p.id, num: p.number, name: formatName(p, team.name_format), avg: avg.get(p.id) }));
    const fromLast = last ? lineupFromLast(last, players, team.name_format) : null;
    const fromRoster = lineupFromRoster(players, team.name_format);
    if (fromLast) presets.push({ label: 'Same as last game', lineup: fromLast });
    presets.push({ label: 'Whole roster, by number', lineup: fromRoster });
    initial = (saved && withRosterNames(saved, players, team.name_format)) ?? fromLast ?? fromRoster;
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

  const pad = `/pad/${slug}/${game.id}`;
  const keep = fromPad ? '&from=pad' : '';
  const run = canRunGames(role);
  return (
    <div className="page" style={{ paddingTop: 6 }}>
      <LineupEditor key={side} slug={slug} gameId={game.id} side={side} initial={initial} stored={!!saved} pool={pool} presets={presets}
        canEdit={run} canRoster={canEditTeam(role)} ai={run && aiOn(await getAllowance(supabase, team.id))}
        back={fromPad ? { href: pad, label: 'Back to the pad' } : { href: `/t/${slug}/games/${game.id}`, label: 'Back to the game' }}
        sides={[
          { href: `?side=us${keep}`, label: team.display_name, on: side === 'us' },
          { href: `?side=them${keep}`, label: game.opponent?.display_name ?? game.opponent_name, on: side === 'them' },
        ]}
        next={run && game.status !== 'final'
          ? { href: pad, label: fromPad || game.status === 'live' ? 'Back to the pad' : 'Open the pad' }
          : { href: `/t/${slug}/games/${game.id}`, label: 'Back to the game' }} />
    </div>
  );
}
