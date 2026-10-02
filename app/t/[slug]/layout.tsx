import { TabBar } from '@/components/TabBar';
import { TeamHeader } from '@/components/TeamHeader';
import { listSeasons, loadTeam } from '@/lib/data';
import { inkOn } from '@/lib/format';

export default async function TeamLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const season = (await listSeasons(supabase, team.id)).find((s) => s.is_current);
  return (
    <div className="shell has-tabs" style={{ '--team': team.color, '--team-ink': inkOn(team.color) } as React.CSSProperties}>
      <TeamHeader team={team} role={role} season={season} />
      {children}
      <TabBar slug={slug} />
    </div>
  );
}
