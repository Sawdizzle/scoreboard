import type { Metadata } from 'next';
import { PeopleView } from '@/components/views/PeopleView';
import { listInvites, listMembers, listPlayers, listStaff, loadTeam } from '@/lib/data';
import { origin } from '@/lib/origin';
import type { Org } from '@/lib/types';

export const metadata: Metadata = { title: 'People' };

export default async function People({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role, userId } = await loadTeam(slug);
  const [staff, invites, members, players, { data: link }, { data: org }] = await Promise.all([
    listStaff(supabase, team.id), listInvites(supabase, team.id), listMembers(supabase, team.id), listPlayers(supabase, team.id),
    supabase.from('team_family_links').select('token, require_approval').eq('team_id', team.id).maybeSingle<{ token: string; require_approval: boolean }>(),
    team.org_id ? supabase.from('organizations').select('id, slug, name, color, logo_url').eq('id', team.org_id).maybeSingle<Org>() : Promise.resolve({ data: null }),
  ]);
  return <PeopleView team={team} role={role} me={userId} staff={staff} invites={invites} members={members} players={players}
    link={link} org={org} origin={await origin()} />;
}
