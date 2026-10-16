import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SeasonCards } from '@/components/SeasonCards';
import { aiOn, getAllowance } from '@/lib/ai-limit';
import { listSeasons, loadTeam } from '@/lib/data';
import { canWriteRecaps } from '@/lib/types';

export const metadata: Metadata = { title: 'Season cards' };

export default async function CardsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ s?: string }> }) {
  const { slug } = await params;
  const { s } = await searchParams;
  const { supabase, team, role } = await loadTeam(slug);
  if (!canWriteRecaps(role) || !aiOn(await getAllowance(supabase, team.id))) notFound();
  const seasons = await listSeasons(supabase, team.id);
  const season = seasons.find((x) => x.id === s) ?? seasons.find((x) => x.is_current) ?? seasons[0];
  if (!season) notFound();
  return (
    <div className="page" style={{ paddingTop: 10 }}>
      <Link href={`/t/${slug}/stats?s=${season.id}`} className="link">‹ Stats</Link>
      <h1 className="disp h2">{season.name} player cards</h1>
      <SeasonCards teamId={team.id} seasonId={season.id} season={season.name} />
    </div>
  );
}
