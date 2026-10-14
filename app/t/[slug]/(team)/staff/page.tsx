import type { Metadata } from 'next';
import { StaffView } from '@/components/views/StaffView';
import { listInvites, listStaff, loadTeam } from '@/lib/data';
import { origin } from '@/lib/origin';

export const metadata: Metadata = { title: 'Staff' };

export default async function Staff({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role, userId } = await loadTeam(slug);
  const [staff, invites] = await Promise.all([listStaff(supabase, team.id), listInvites(supabase, team.id)]);
  return <StaffView team={team} role={role} me={userId} staff={staff} invites={invites} origin={await origin()} />;
}
