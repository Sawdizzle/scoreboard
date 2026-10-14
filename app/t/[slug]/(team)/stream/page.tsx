import type { Metadata } from 'next';
import { StreamSetup, type StreamChannel } from '@/components/stream/StreamSetup';
import { loadTeam } from '@/lib/data';
import { origin } from '@/lib/origin';
import { canEditTeam } from '@/lib/types';

export const metadata: Metadata = { title: 'Stream' };

// How the stream looks, set in one place with a live preview. Any seat can
// change the look and the layout; the line, link, sponsor and a new link are
// for the team's leads.
export default async function Stream({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const { data: channel } = await supabase.from('channels').select('*').eq('team_id', team.id).maybeSingle<StreamChannel & { token: string }>();
  if (!channel) return <div className="page"><p className="note note-plain">The stream is not set up for this team yet.</p></div>;
  return <StreamSetup team={team} channel={channel} streamUrl={`${await origin()}/overlay/${channel.token}`} canLead={canEditTeam(role)} />;
}
