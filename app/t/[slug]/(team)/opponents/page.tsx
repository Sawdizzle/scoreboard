import type { Metadata } from 'next';
import Link from 'next/link';
import { createOpponent } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { TeamMark } from '@/components/TeamBrand';
import { listOpponents, loadTeam } from '@/lib/data';

export const metadata: Metadata = { title: 'Opponents' };

// The teams you play: each with its logo, colours and roster, ready for New game.
export default async function Opponents({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team } = await loadTeam(slug);
  const list = await listOpponents(supabase, team.id);
  return (
    <div className="page" style={{ paddingTop: 6 }}>
      <ActionForm action={createOpponent.bind(null, slug)} className="form">
        <div className="field-row" style={{ gridTemplateColumns: '1fr auto' }}>
          <label className="field"><span>Add a team you play</span>
            <input className="input" name="name" maxLength={60} placeholder="Sanger Wolf" autoComplete="off" required />
          </label>
          <Submit className="btn btn-primary" busy="Adding…">Add</Submit>
        </div>
      </ActionForm>
      {list.length === 0 ? (
        <div className="card empty"><b>No opponents yet</b>Add the teams you play: their logo, colours and roster come up on the pad and the stream.</div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {list.map((o) => {
            const n = (o.roster?.batters ?? []).filter((b) => b.num || b.name).length;
            return (
              <Link key={o.id} href={`/t/${slug}/opponents/${o.id}`} className="card seat">
                <TeamMark brand={{ name: o.name, display: o.name, color: o.color, color2: o.color2, logo: o.logo_url }} />
                <span className="row-main">
                  <span className="row-title">{o.name}<small>{o.abbr}</small></span>
                  <span className="row-meta">{n ? `${n} ${n === 1 ? 'player' : 'players'}` : 'No roster yet'}{o.logo_url ? '' : ' · no logo'}</span>
                </span>
                <span className="link">Edit</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
