import Link from 'next/link';
import { leaveTeam } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { SiteCredit } from '@/components/SiteCredit';
import { Slab, brandOf } from '@/components/TeamBrand';
import { TeamFrame } from '@/components/TeamFrame';
import { listSeasons, loadMember } from '@/lib/data';

export default async function TeamLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, seat, status } = await loadMember(slug);
  // A parent waiting for a coach to approve them sees the team and nothing else.
  if (status === 'pending') {
    return (
      <main className="shell" style={{ '--team': team.color } as React.CSSProperties}>
        <div className="page" style={{ paddingTop: 16 }}>
          <Slab brand={brandOf(team)} sub={team.age_group ?? ''} />
          <h1 className="disp h1">Waiting for the coach</h1>
          <p className="lede">Your request to join as a parent is in. Once a coach approves it, the team&rsquo;s calendar and messages open here.</p>
          <Link href="/t" className="btn btn-quiet btn-big">Your teams</Link>
          <ActionForm action={leaveTeam.bind(null, slug)}>
            <Submit className="link" busy="Withdrawing…">Withdraw my request</Submit>
          </ActionForm>
        </div>
        <SiteCredit />
      </main>
    );
  }
  const season = (await listSeasons(supabase, team.id)).find((s) => s.is_current);
  return <TeamFrame team={team} role={seat} season={season}>{children}</TeamFrame>;
}
