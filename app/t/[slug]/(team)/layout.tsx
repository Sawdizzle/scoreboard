import { TeamTabs } from '@/components/TabBar';
import { loadTeam } from '@/lib/data';

// Roster, Staff and Team share one tab, so they share its switch. The counts
// are head-only queries: no rows come back, only how many there are.
export default async function TeamSection({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team } = await loadTeam(slug);
  const [players, staff] = await Promise.all([
    supabase.from('players').select('id', { count: 'exact', head: true }).eq('team_id', team.id).eq('active', true),
    supabase.from('team_staff').select('user_id', { count: 'exact', head: true }).eq('team_id', team.id),
  ]);
  return (
    <>
      <div className="page-top" style={{ paddingTop: 10 }}>
        <TeamTabs slug={slug} players={players.count ?? 0} staff={staff.count ?? 0} />
      </div>
      {children}
    </>
  );
}
