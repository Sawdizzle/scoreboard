import { notFound, redirect } from 'next/navigation';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Scoreboard v4's recap links (/recap?game=<v4 id>) land on the game's public
// page. v4 games were brought over with their ids recorded in legacy_games.
export default async function LegacyRecap({ searchParams }: { searchParams: Promise<{ game?: string }> }) {
  const id = (await searchParams).game ?? '';
  if (!UUID.test(id) || !supabaseConfigured) notFound();
  const supabase = await createClient();
  const { data: map } = await supabase.from('legacy_games').select('game_id').eq('v4_id', id).maybeSingle();
  const { data: game } = await supabase.from('games').select('id, teams!games_team_id_fkey(slug)').eq('id', map?.game_id ?? id).maybeSingle();
  const slug = (game?.teams as { slug?: string } | null)?.slug;
  if (!game || !slug) notFound();
  redirect(`/team/${slug}/game/${game.id}`);
}
