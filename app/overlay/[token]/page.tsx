import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Overlay } from '@/components/overlay/Overlay';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import type { Feed } from '@/lib/onair';

export const metadata: Metadata = { title: 'Scorebug', robots: { index: false, follow: false } };

// The Browser Source: a transparent page for OBS or any streaming software.
// The link's token is the only key; there is no sign-in here.
export default async function OverlayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token) || !supabaseConfigured) notFound();
  const supabase = await createClient();
  const [{ data, error }, season] = await Promise.all([
    supabase.rpc('overlay_feed', { p_token: token }),
    supabase.rpc('overlay_season', { p_token: token }),
  ]);
  // An unknown link is a 404. A failed call (a blip mid-stream, after a
  // reload) is not: the page starts empty and its own polling fills it in.
  if (!data && !error) notFound();
  // Season lines are their own call now; the page starts with both.
  const feed = (data as Feed | null) ?? null;
  const lines = (season.data as { season_stats?: Feed['season_stats'] } | null)?.season_stats;
  if (feed && !feed.season_stats?.length && lines?.length) feed.season_stats = lines;
  return <Overlay token={token} initial={feed} />;
}
