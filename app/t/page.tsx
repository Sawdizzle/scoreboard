import type { Metadata } from 'next';
import Link from 'next/link';
import { deleteAccount, signOut, updateProfile } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { createClient } from '@/lib/supabase/server';
import { ChevronRight, Plus } from '@/components/icons';
import { myOrgs, myTeams, requireUserId } from '@/lib/data';
import { TeamMark, brandOf } from '@/components/TeamBrand';
import { SEAT_LABEL } from '@/lib/types';

export const metadata: Metadata = { title: 'Your teams' };

export default async function Teams() {
  const me = await requireUserId('/t');
  const [teams, orgs] = await Promise.all([myTeams(), myOrgs()]);
  const { data: profile } = await (await createClient()).from('profiles').select('display_name').eq('id', me).maybeSingle<{ display_name: string }>();
  return (
    <main className="shell">
      <div className="page-top">
        <div className="h-row">
          <h1 className="disp h1">Your teams</h1>
          <form action={signOut}><button className="link" type="submit">Sign out</button></form>
        </div>
      </div>
      <div className="page">
        {teams.length === 0 ? (
          <div className="card empty">
            <b>No team yet</b>
            Create one, open an invite or family link a coach sent you, or follow a team from its page.
          </div>
        ) : (
          <div className="stack">
            {teams.map(({ team, seat, pending }) => (
              <Link key={team.id} href={`/t/${team.slug}`} className="card seat">
                <TeamMark brand={brandOf(team)} size={50} />
                <span className="row-main">
                  <span className="row-title">{team.display_name}{team.age_group && <small>{team.age_group}</small>}</span>
                  <span className="row-meta">{SEAT_LABEL[seat]}{pending && ' · waiting for approval'}</span>
                </span>
                <span className="chev"><ChevronRight /></span>
              </Link>
            ))}
          </div>
        )}
        <Link href="/t/new" className="btn btn-primary btn-big"><Plus /> New team</Link>
        <h2 className="h-sec">Leagues</h2>
        {orgs.map((o) => (
          <Link key={o.id} href={`/org/${o.slug}`} className="card seat">
            <span className="row-main"><span className="row-title">{o.name}</span><span className="row-meta">League admin</span></span>
            <span className="chev"><ChevronRight /></span>
          </Link>
        ))}
        <Link href="/org/new" className="btn btn-quiet btn-big"><Plus /> New league</Link>
        <details className="fold">
          <summary>Your name · {profile?.display_name ?? ''}</summary>
          <div className="fold-body">
            <ActionForm action={updateProfile} className="form">
              <label className="field"><span>Your name</span>
                <input className="input" name="display_name" defaultValue={profile?.display_name ?? ''} maxLength={60} required autoComplete="name" />
              </label>
              <Submit busy="Saving…">Save name</Submit>
            </ActionForm>
          </div>
        </details>
        <details className="fold danger">
          <summary>Delete your account</summary>
          <div className="fold-body">
            <ActionForm action={deleteAccount} className="form">
              <p className="hint">This deletes your account and your seat on every team. Teams, games and players stay with their other staff. If you are a team&rsquo;s only organizer, make someone else one (or delete the team) first.</p>
              <label className="field"><span>Type DELETE to confirm</span>
                <input className="input" name="confirm" autoComplete="off" placeholder="DELETE" required />
              </label>
              <Submit busy="Deleting…">Delete my account</Submit>
            </ActionForm>
          </div>
        </details>
        <p className="sub" style={{ textAlign: 'center' }}><Link href="/privacy" className="link">Privacy</Link></p>
      </div>
    </main>
  );
}
