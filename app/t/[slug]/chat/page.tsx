import type { Metadata } from 'next';
import { ChatView } from '@/components/hub/ChatView';
import { listMessages, loadMember, orgAnnouncements } from '@/lib/data';
import { canCoach, isStaff, type Channel } from '@/lib/types';

export const metadata: Metadata = { title: 'Chat' };

// Three channels a team has, each open to whom it is for: announcements to the
// family, the parents' chat, and staff. A fan reads none of them; the team's
// scores are theirs instead.
export default async function Chat({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string }> }) {
  const { slug } = await params;
  const { supabase, team, seat, userId } = await loadMember(slug);
  if (seat === 'fan') {
    return (
      <div className="page" style={{ paddingTop: 16 }}>
        <h1 className="disp h1">Chat</h1>
        <div className="card empty"><b>For the team&rsquo;s families</b>Announcements and the parents&rsquo; chat are for parents and staff. As a fan you get game times and scores.</div>
      </div>
    );
  }
  const channels: Channel[] = isStaff(seat) ? ['announcements', 'families', 'staff'] : ['announcements', 'families'];
  const asked = (await searchParams).c as Channel;
  const channel = channels.includes(asked) ? asked : 'announcements';
  const [initial, league] = await Promise.all([
    listMessages(supabase, team.id, channel),
    channel === 'announcements' && team.org_id ? orgAnnouncements(supabase, team.org_id, 10) : Promise.resolve([]),
  ]);
  return (
    <div className="page" style={{ paddingTop: 16 }}>
      <h1 className="disp h1">Chat</h1>
      <ChatView key={channel} slug={slug} teamId={team.id} me={userId} channel={channel} channels={channels} initial={initial}
        canPost={channel === 'announcements' ? canCoach(seat) : true} moderate={canCoach(seat)} league={league} />
    </div>
  );
}
