import type { Metadata } from 'next';
import Link from 'next/link';
import { signOut, updateProfile } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { createClient } from '@/lib/supabase/server';
import { ChevronRight, Plus } from '@/components/icons';
import { myTeams, requireUserId } from '@/lib/data';
import { inkOn } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/types';

export const metadata: Metadata = { title: 'Your teams' };

export default async function Teams() {
  const me = await requireUserId('/t');
  const teams = await myTeams();
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
            Create one, or open an invite link a team&rsquo;s organizer sent you.
          </div>
        ) : (
          <div className="stack">
            {teams.map(({ team, role }) => (
              <Link key={team.id} href={`/t/${team.slug}`} className="card seat">
                <span className="crest" style={{ '--team': team.color, '--team-ink': inkOn(team.color), fontSize: team.abbr.length > 4 ? 13 : 19 } as React.CSSProperties}>{team.abbr}</span>
                <span className="row-main">
                  <span className="row-title">{team.name}{team.age_group && <small>{team.age_group}</small>}</span>
                  <span className="row-meta">{ROLE_LABEL[role]}</span>
                </span>
                <span className="chev"><ChevronRight /></span>
              </Link>
            ))}
          </div>
        )}
        <Link href="/t/new" className="btn btn-primary btn-big"><Plus /> New team</Link>
        <details className="fold">
          <summary>Your name · {profile?.display_name ?? ''}</summary>
          <div className="fold-body">
            <ActionForm action={updateProfile} className="form">
              <label className="field"><span>Shown on staff lists</span>
                <input className="input" name="display_name" defaultValue={profile?.display_name ?? ''} maxLength={60} required autoComplete="name" />
              </label>
              <Submit busy="Saving…">Save name</Submit>
            </ActionForm>
          </div>
        </details>
      </div>
    </main>
  );
}
