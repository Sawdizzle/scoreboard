import { TabBar } from '@/components/TabBar';
import { TeamHeader } from '@/components/TeamHeader';
import type { Role, Season, Team } from '@/lib/types';

// A team's screens, framed for the device. On a phone: the team at the top
// and the three tabs along the bottom. From an iPad on its side up: a sidebar
// with the team and every section, and the screen beside it, wide.
// `at` overrides the address, for the component sheet at /dev/kit.
export function TeamFrame({ team, role, season, at, children }: { team: Team; role: Role; season?: Season; at?: string; children: React.ReactNode }) {
  return (
    <div className="shell has-tabs framed" style={{ '--team': team.color } as React.CSSProperties}>
      <aside className="frame-side">
        <TeamHeader team={team} role={role} season={season} />
        <TabBar slug={team.slug} at={at} />
      </aside>
      <div className="frame-main">{children}</div>
    </div>
  );
}
