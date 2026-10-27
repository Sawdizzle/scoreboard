import type { Metadata } from 'next';
import Link from 'next/link';
import { joinFamily } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { Slab } from '@/components/TeamBrand';
import { getUserId } from '@/lib/data';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Join the team', robots: { index: false } };

type Preview = {
  team_id: string; slug: string; name: string; display_name: string; color: string; color2: string; logo_url: string | null;
  age_group: string | null; approval: boolean; players: { id: string; number: string; name: string }[];
};

// The family link: a parent signs in (or up), picks their player, and joins.
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let pv: Preview | null = null;
  if (supabaseConfigured && /^[0-9a-f-]{36}$/i.test(token)) {
    const { data } = await (await createClient()).rpc('family_preview', { p_token: token });
    pv = (data as Preview | null) ?? null;
  }
  const signedIn = pv ? !!(await getUserId()) : false;
  const next = encodeURIComponent(`/join/${token}`);
  return (
    <main className="shell">
      <div className="front">
        <Link href="/" className="wordmark">SCOREBOARD</Link>
        {!pv ? (
          <>
            <h1 className="disp h1">Link not found</h1>
            <p className="lede">This family link does not work anymore. Ask the coach for the current one.</p>
          </>
        ) : (
          <>
            <div style={{ borderRadius: 16, overflow: 'hidden' }}>
              <Slab brand={{ name: pv.name, display: pv.display_name, color: pv.color, color2: pv.color2, logo: pv.logo_url }}
                sub={`${pv.name}${pv.age_group ? ` ${pv.age_group}` : ''}`} />
            </div>
            <span className="eyebrow gold">Join as a parent or guardian</span>
            <h1 className="disp h1">{pv.display_name}</h1>
            <p className="lede">The team&rsquo;s calendar in your phone, one-tap RSVPs, announcements from the coaches and the parents&rsquo; chat.{pv.approval && ' A coach approves you first.'}</p>
            {!signedIn ? (
              <div className="btn-row">
                <Link href={`/sign-up?next=${next}`} className="btn btn-primary btn-big">Create account</Link>
                <Link href={`/sign-in?next=${next}`} className="btn btn-quiet btn-big">Sign in</Link>
              </div>
            ) : pv.players.length === 0 ? (
              <p className="note note-plain">The roster is empty. Ask the coach to add the players, then open this link again.</p>
            ) : (
              <ActionForm action={joinFamily.bind(null, token)} className="form">
                <fieldset>
                  <legend className="legend">Your player (pick each of yours)</legend>
                  <div className="pills">
                    {pv.players.map((p) => (
                      <label key={p.id} className="pill wide">
                        <input type="checkbox" name="player" value={p.id} />
                        <span>{p.number ? `#${p.number} ` : ''}{p.name}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Submit className="btn btn-primary btn-big" busy="Joining…">Join the team</Submit>
              </ActionForm>
            )}
          </>
        )}
      </div>
    </main>
  );
}
