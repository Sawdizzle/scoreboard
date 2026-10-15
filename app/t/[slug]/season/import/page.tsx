import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from '@/components/icons';
import { ImportFlow } from '@/components/ImportFlow';
import { listPlayers, listSeasons, loadTeam, padScoredGames } from '@/lib/data';
import { padGamesBySeason } from '@/lib/gamechanger';
import { canEditTeam } from '@/lib/types';

export const metadata: Metadata = { title: 'Import from GameChanger' };

export default async function ImportPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ s?: string }>;
}) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const [seasons, players, padGames] = await Promise.all([
    listSeasons(supabase, team.id), listPlayers(supabase, team.id), padScoredGames(supabase, team.id),
  ]);
  return (
    <div className="page" style={{ paddingTop: 6 }}>
      <div className="h-row" style={{ justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
        <Link href={`/t/${slug}/season`} aria-label="Back to the season" className="icon-btn" style={{ border: 0, marginLeft: -10 }}><ChevronLeft /></Link>
        <h1 className="disp h2">Import from GameChanger</h1>
      </div>
      {!canEditTeam(role) ? (
        <p className="note note-plain">The organizer or head coach imports stats.</p>
      ) : seasons.length === 0 ? (
        <p className="note note-plain">Create a season first: an import fills one season.</p>
      ) : (
        <ImportFlow slug={slug} seasons={seasons} seasonId={(await searchParams).s} padGames={padGamesBySeason(padGames)}
          roster={players.map(({ id, number, first_name, last_name }) => ({ id, number, first_name, last_name }))} />
      )}
    </div>
  );
}
