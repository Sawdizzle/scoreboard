import { TeamFrame } from '@/components/TeamFrame';
import { listSeasons, loadTeam } from '@/lib/data';

export default async function TeamLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const season = (await listSeasons(supabase, team.id)).find((s) => s.is_current);
  return <TeamFrame team={team} role={role} season={season}>{children}</TeamFrame>;
}
