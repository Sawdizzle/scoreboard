import { notFound } from 'next/navigation';
import { TeamTabs } from '@/components/TabBar';
import { loadTeam } from '@/lib/data';
import { canBroadcast, canSeeTeam } from '@/lib/types';

// Roster, People, Opponents, Team and Stream share one tab, so they share its switch. The counts
// are head-only queries: no rows come back, only how many there are. A broadcaster's switch holds
// the stream and its setup guide only; a scorer has none of this section.
export default async function TeamSection({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  if (!canBroadcast(role)) notFound();
  const [players, opponents, waiting] = await Promise.all([
    supabase.from('players').select('id', { count: 'exact', head: true }).eq('team_id', team.id).eq('active', true),
    supabase.from('opponents').select('id', { count: 'exact', head: true }).eq('team_id', team.id),
    supabase.from('team_members').select('user_id', { count: 'exact', head: true }).eq('team_id', team.id).eq('status', 'pending'),
  ]);
  return (
    <>
      {/* The sidebar lists these sections from an iPad on its side up, so the switch is for smaller screens. */}
      <div className="page-top team-tabs" style={{ paddingTop: 10 }}>
        <TeamTabs slug={slug} players={players.count ?? 0} opponents={opponents.count ?? 0} people={waiting.count ?? 0} streamOnly={!canSeeTeam(role)} />
      </div>
      {children}
    </>
  );
}
