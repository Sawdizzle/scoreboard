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
  const { data } = await supabase.rpc('overlay_feed', { p_token: token });
  if (!data) notFound();
  return <Overlay token={token} initial={data as Feed} />;
}
