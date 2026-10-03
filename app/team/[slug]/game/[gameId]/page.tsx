import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LiveGame } from '@/components/public/LiveGame';
import type { PublicGame } from '@/lib/public';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';

type Props = { params: Promise<{ slug: string; gameId: string }> };

async function load(slug: string, gameId: string) {
  if (!supabaseConfigured || !/^[0-9a-f-]{36}$/i.test(gameId)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.rpc('public_game', { p_game: gameId });
  const game = data as PublicGame | null;
  // The address names the team; a game is only shown under its own.
  if (!game || game.team.slug !== slug) notFound();
  return game;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, gameId } = await params;
  const g = await load(slug, gameId);
  const [away, home] = g.game.is_home ? [g.opponent, g.team] : [g.team, g.opponent];
  return { title: `${away.display_name} at ${home.display_name}` };
}

// A game as anyone may follow it: the score as it happens, the line score,
// both box scores and each time up.
export default async function GamePage({ params }: Props) {
  const { slug, gameId } = await params;
  return <LiveGame initial={await load(slug, gameId)} />;
}
