import type { Metadata } from 'next';
import { SeasonView } from '@/components/views/SeasonView';
import { aiOn, getAllowance } from '@/lib/ai-limit';
import { listGames, listPlayers, listSeasons, loadTeam, seasonStats } from '@/lib/data';

export const metadata: Metadata = { title: 'Season' };

export default async function SeasonPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ s?: string; imported?: string; added?: string }>;
}) {
  const { slug } = await params;
  const { s, imported, added } = await searchParams;
  const { supabase, team, role } = await loadTeam(slug);
  const [seasons, players] = await Promise.all([listSeasons(supabase, team.id), listPlayers(supabase, team.id)]);
  const sel = seasons.find((x) => x.id === s) ?? seasons.find((x) => x.is_current) ?? seasons[0];
  const [stats, games] = sel ? await Promise.all([seasonStats(supabase, team.id, sel.id), listGames(supabase, team.id, sel.id)]) : [[], []];
  return <SeasonView team={team} role={role} seasons={seasons} selectedId={sel?.id} stats={stats} players={players} games={games}
    imported={imported && /^\d+$/.test(imported) ? imported : undefined}
    added={added && /^\d+$/.test(added) ? added : undefined} ai={aiOn(await getAllowance(supabase, team.id))} />;
}
