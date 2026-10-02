import type { Metadata } from 'next';
import { SeasonView } from '@/components/views/SeasonView';
import { listSeasons, loadTeam } from '@/lib/data';

export const metadata: Metadata = { title: 'Season' };

export default async function SeasonPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ s?: string }>;
}) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  return <SeasonView team={team} role={role} seasons={await listSeasons(supabase, team.id)} selectedId={(await searchParams).s} />;
}
