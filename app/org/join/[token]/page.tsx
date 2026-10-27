import type { Metadata } from 'next';
import Link from 'next/link';
import { acceptOrgInvite } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { getUserId, myTeams } from '@/lib/data';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'League invite', robots: { index: false } };

type Preview = { org_name: string; org_color: string; kind: 'admin' | 'team'; state: 'open' | 'used' | 'expired' };

// A league link: 'admin' makes the holder a league admin; 'team' lets a team
// admin put one of their teams in the league.
export default async function OrgJoin({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let pv: Preview | null = null;
  if (supabaseConfigured && /^[0-9a-f-]{36}$/i.test(token)) {
    const { data } = await (await createClient()).rpc('org_invite_preview', { p_token: token });
    pv = ((data ?? []) as Preview[])[0] ?? null;
  }
  const signedIn = pv ? !!(await getUserId()) : false;
  const mine = signedIn && pv?.kind === 'team' ? (await myTeams()).filter((t) => t.seat === 'organizer' && !t.team.org_id) : [];
  const next = encodeURIComponent(`/org/join/${token}`);
  return (
    <main className="shell">
      <div className="front">
        <Link href="/" className="wordmark">SCOREBOARD</Link>
        {!pv ? (
          <><h1 className="disp h1">Invite not found</h1><p className="lede">Check that the whole link was copied.</p></>
        ) : (
          <>
            <span className="eyebrow gold">{pv.kind === 'admin' ? 'You are invited as a league admin' : 'Put your team in the league'}</span>
            <h1 className="disp h1">{pv.org_name}</h1>
            <p className="lede">{pv.kind === 'admin'
              ? 'League admins run every team in the league, post to every family, and see the league calendar.'
              : 'The league’s admins can then help run your team, and its families get league announcements.'}</p>
            {pv.state !== 'open' ? (
              <p className="note note-bad">This link {pv.state === 'used' ? 'was already used' : 'has expired'}. Ask the league for a new one.</p>
            ) : !signedIn ? (
              <div className="btn-row">
                <Link href={`/sign-up?next=${next}`} className="btn btn-primary btn-big">Create account</Link>
                <Link href={`/sign-in?next=${next}`} className="btn btn-quiet btn-big">Sign in</Link>
              </div>
            ) : pv.kind === 'admin' ? (
              <ActionForm action={acceptOrgInvite.bind(null, token)} className="form">
                <Submit className="btn btn-primary btn-big" busy="Joining…">Become a league admin</Submit>
              </ActionForm>
            ) : mine.length === 0 ? (
              <p className="note note-plain">You are not the team admin of a team outside a league. The team admin opens this link.</p>
            ) : (
              <ActionForm action={acceptOrgInvite.bind(null, token)} className="form">
                <fieldset>
                  <legend className="legend">Which team</legend>
                  <div className="pills">
                    {mine.map(({ team }, i) => (
                      <label key={team.id} className="pill wide">
                        <input type="radio" name="team" value={team.id} defaultChecked={i === 0} />
                        <span>{team.display_name}{team.age_group ? ` ${team.age_group}` : ''}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Submit className="btn btn-primary btn-big" busy="Joining…">Join the league</Submit>
              </ActionForm>
            )}
          </>
        )}
      </div>
    </main>
  );
}
