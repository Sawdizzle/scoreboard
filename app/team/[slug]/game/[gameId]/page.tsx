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
  const game = await load(slug, gameId);
  // A recap shows only once a coach has published it (the policy hides drafts).
  const supabase = await createClient();
  const { data } = await supabase.from('game_recaps').select('content, content_es').eq('game_id', game.game.id).eq('status', 'published')
    .maybeSingle<{ content: { headline: string; recap: string }; content_es: { headline: string; recap: string } | null }>();
  return <LiveGame initial={game} recap={data ? { ...data.content, es: data.content_es } : null} />;
}
