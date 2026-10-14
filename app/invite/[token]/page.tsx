import type { Metadata } from 'next';
import Link from 'next/link';
import { acceptInvite } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { getUserId } from '@/lib/data';
import { Slab } from '@/components/TeamBrand';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import { ROLE_CAN, ROLE_LABEL, type Role } from '@/lib/types';

export const metadata: Metadata = { title: 'Team invite', robots: { index: false } };

type Preview = { team_name: string; display_name: string; team_color: string; team_color2: string; logo_url: string | null; age_group: string | null; role: Role; state: 'open' | 'used' | 'expired' | 'full' };
const CLOSED: Record<Exclude<Preview['state'], 'open'>, string> = {
  used: 'This invite link was already used. Ask the organizer for a new one.',
  expired: 'This invite link has expired. Ask the organizer for a new one.',
  full: 'All five seats on this team are filled.',
};

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let pv: Preview | null = null;
  if (supabaseConfigured && /^[0-9a-f-]{36}$/i.test(token)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc('invite_preview', { p_token: token });
    pv = ((data ?? []) as Preview[])[0] ?? null;
  }
  const signedIn = pv ? !!(await getUserId()) : false;
  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <main className="shell">
      <div className="front">
        <Link href="/" className="mark">SCOREBOARD</Link>
        {!pv ? (
          <>
            <h1 className="disp h1">Invite not found</h1>
            <p className="lede">This link does not match an invite. Check that the whole link was copied.</p>
          </>
        ) : (
          <>
            <div style={{ borderRadius: 16, overflow: 'hidden' }}>
              <Slab brand={{ name: pv.team_name, display: pv.display_name, color: pv.team_color, color2: pv.team_color2, logo: pv.logo_url }}
                sub={`${pv.team_name}${pv.age_group ? ` ${pv.age_group}` : ''}`} />
            </div>
            <span className="eyebrow gold">You are invited as</span>
            <h1 className="disp h1">{ROLE_LABEL[pv.role]}</h1>
            <p className="lede">{ROLE_CAN[pv.role]}.</p>
            {pv.state !== 'open' ? (
              <p className="note note-bad">{CLOSED[pv.state]}</p>
            ) : signedIn ? (
              <ActionForm action={acceptInvite.bind(null, token)} className="form">
                <Submit className="btn btn-primary btn-big" busy="Joining…">Take the seat</Submit>
              </ActionForm>
            ) : (
              <div className="btn-row">
                <Link href={`/sign-up?next=${next}`} className="btn btn-primary btn-big">Create account</Link>
                <Link href={`/sign-in?next=${next}`} className="btn btn-quiet btn-big">Sign in</Link>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
