import { notFound } from 'next/navigation';
import { TabBar, TeamTabs } from '@/components/TabBar';
import { TeamHeader } from '@/components/TeamHeader';
import { PlayerView } from '@/components/views/PlayerView';
import { RosterView } from '@/components/views/RosterView';
import { SeasonView } from '@/components/views/SeasonView';
import { SettingsView } from '@/components/views/SettingsView';
import { StaffView } from '@/components/views/StaffView';
import { TodayView } from '@/components/views/TodayView';
import { inkOn } from '@/lib/format';
import type { Invite, Player, Position, Role, Season, StaffMember, Team } from '@/lib/types';

// Every team screen, drawn from made-up data with no database behind it:
// /dev/kit?v=roster (today, roster, player, staff, season, settings), and
// &role=coach to see a seat that cannot edit. Development only. The forms are
// real, so submitting one here fails at the first query; it is for looking.
const team: Team = { id: 't1', slug: 'blue-steel-14u', name: 'Blue Steel', abbr: 'STEEL', color: '#2857b5', logo_url: null, age_group: '14U' };
const season: Season = { id: 's1', team_id: 't1', name: 'Fall 2026', starts_on: '2026-09-05', ends_on: '2026-11-15', is_current: true };
const seasons: Season[] = [season, { id: 's2', team_id: 't1', name: 'Spring 2026', starts_on: null, ends_on: null, is_current: false }];
const P = (id: number, number: string, first_name: string, last_name: string, positions: Position[], bats: Player['bats'], throws: Player['throws'], active = true): Player =>
  ({ id: `p${id}`, team_id: 't1', number, first_name, last_name, positions, bats, throws, public_name: 'full', active });
const players: Player[] = [
  P(1, '3', 'Cy', 'Park', ['CF'], 'L', 'L'), P(2, '7', 'Johnny', 'Vance', ['SS', '2B'], 'R', 'R'),
  P(3, '21', 'Finn', 'Moore', ['C'], 'R', 'R'), P(4, '18', 'Marco', 'Diaz', ['1B'], 'L', 'L'),
  P(5, '12', 'Ben', 'Ortiz', ['P', '1B'], 'R', 'R'), P(6, '9', 'Theo', 'Lang', ['3B'], 'R', 'R'),
  P(7, '24', 'Sam', 'Whitaker', ['LF'], 'S', 'R'), P(8, '5', 'Nico', 'Ruiz', ['2B'], 'R', 'R'),
  P(9, '33', 'Owen', 'Tate', ['RF', 'P'], 'R', 'R'), P(10, '11', 'Jack', 'Hill', [], null, null),
  P(11, '2', 'Leo', 'Kim', ['UT'], 'L', 'R'), P(12, '40', 'Max', 'Reed', ['P'], 'R', 'R', false),
];
const staff: StaffMember[] = [
  { user_id: 'u1', role: 'organizer', display_name: 'Shawn W.' }, { user_id: 'u2', role: 'head_coach', display_name: 'Ray Dalton' },
  { user_id: 'u3', role: 'coach', display_name: 'Mia Torres' }, { user_id: 'u4', role: 'scorer', display_name: 'Kev Oliver' },
];
const invites: Invite[] = [{ token: '5f0c2c1e-0000-4000-8000-000000000000', role: 'media', expires_at: '2026-10-09T00:00:00Z' }];

export default async function Kit({ searchParams }: { searchParams: Promise<{ v?: string; role?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { v = 'today', role: r } = await searchParams;
  const role = (r ?? 'organizer') as Role;
  const base = `/t/${team.slug}`;
  const at = v === 'today' ? base : `${base}/${v}`;
  const tabs = <div className="page-top" style={{ paddingTop: 10 }}><TeamTabs slug={team.slug} players={11} staff={4} at={at} /></div>;
  return (
    <div className="shell has-tabs" style={{ '--team': team.color, '--team-ink': inkOn(team.color) } as React.CSSProperties}>
      <TeamHeader team={team} role={role} season={season} />
      {v === 'today' && <TodayView team={team} role={role} players={11} staff={4} season={season} />}
      {v === 'roster' && <>{tabs}<RosterView team={team} role={role} players={players} /></>}
      {v === 'empty' && <>{tabs}<RosterView team={team} role={role} players={[]} /></>}
      {v === 'player' && <PlayerView team={team} role={role} player={players[1]} />}
      {v === 'staff' && <>{tabs}<StaffView team={team} role={role} me="u1" staff={staff} invites={[]} origin="http://localhost:3000" /></>}
      {v === 'staff-link' && <>{tabs}<StaffView team={team} role={role} me="u1" staff={staff} invites={invites} origin="http://localhost:3000" /></>}
      {v === 'season' && <SeasonView team={team} role={role} seasons={seasons} />}
      {v === 'settings' && <>{tabs}<SettingsView team={team} role={role} /></>}
      <TabBar slug={team.slug} at={at} />
    </div>
  );
}
