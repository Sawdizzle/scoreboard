import { TodayView } from '@/components/views/TodayView';
import { listSeasons, loadTeam } from '@/lib/data';

export default async function Today({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const [players, staff, seasons] = await Promise.all([
    supabase.from('players').select('id', { count: 'exact', head: true }).eq('team_id', team.id).eq('active', true),
    supabase.from('team_staff').select('user_id', { count: 'exact', head: true }).eq('team_id', team.id),
    listSeasons(supabase, team.id),
  ]);
  return <TodayView team={team} role={role} players={players.count ?? 0} staff={staff.count ?? 0} season={seasons.find((s) => s.is_current)} />;
}
