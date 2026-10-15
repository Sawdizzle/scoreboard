import type { Metadata } from 'next';
import { StatsView } from '@/components/views/StatsView';
import { listPlayers, listSeasons, loadTeam, seasonStats } from '@/lib/data';

export const metadata: Metadata = { title: 'Stats' };

export default async function StatsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ s?: string }> }) {
  const { slug } = await params;
  const { s } = await searchParams;
  const { supabase, team } = await loadTeam(slug);
  const [seasons, players] = await Promise.all([listSeasons(supabase, team.id), listPlayers(supabase, team.id)]);
  const season = seasons.find((x) => x.id === s) ?? seasons.find((x) => x.is_current) ?? seasons[0];
  const lines = season ? await seasonStats(supabase, team.id, season.id) : [];
  return <StatsView slug={slug} seasons={seasons} season={season} lines={lines} players={players} fmt={team.name_format} />;
}
