import Link from 'next/link';
import { deletePlayer, updatePlayer } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { ChevronLeft } from '@/components/icons';
import { PlayerFields } from '@/components/PlayerFields';
import { fullName, publicName } from '@/lib/format';
import { canEditTeam, type Player, type PublicName, type Role, type Team } from '@/lib/types';

const PUBLIC_LABEL: Record<PublicName, string> = { full: 'Full name', first_initial: 'First name, last initial', number: 'Number only' };

export function PlayerView({ team, role, player: p }: { team: Team; role: Role; player: Player }) {
  const edit = canEditTeam(role);
  const facts = [p.number && `No. ${p.number}`, p.positions.join(' · '), p.bats && `Bats ${p.bats}`, p.throws && `Throws ${p.throws}`].filter(Boolean);
  return (
    <>
      <div className="hero slab">
        {p.number && <span className="hero-num" aria-hidden="true">{p.number}</span>}
        <Link href={`/t/${team.slug}/roster`} aria-label="Back to roster" className="back"><ChevronLeft /></Link>
        <span className="eyebrow">{facts.length ? facts.join(' · ') : team.name}{!p.active && ' · Not active'}</span>
        <h1 className="disp">{fullName(p) || `No. ${p.number}`}</h1>
      </div>

      <div className="page" style={{ paddingTop: 18 }}>
        <section className="stack">
          <div className="slash" aria-label="Season batting line, no games yet">
            {['AVG', 'OBP', 'SLG', 'OPS'].map((k) => <div key={k}><b>–</b><span>{k}</span></div>)}
          </div>
          <p className="sub" style={{ padding: '0 4px' }}>No games scored yet. This line fills itself from the first one.</p>
        </section>

        {edit ? (
          <>
            <ActionForm action={updatePlayer.bind(null, team.slug, p.id)} className="form">
              <PlayerFields p={p} />
              <fieldset>
                <legend className="legend">On the public page and the stream as</legend>
                <div className="stack" style={{ gap: 6 }}>
                  {(Object.keys(PUBLIC_LABEL) as PublicName[]).map((mode) => (
                    <label key={mode} className="pill wide" style={{ display: 'flex' }}>
                      <input type="radio" name="public_name" value={mode} defaultChecked={p.public_name === mode} />
                      <span style={{ flex: 1, justifyContent: 'space-between', borderRadius: 12, gap: 12 }}>
                        <b>{publicName(p, mode)}</b><small style={{ fontWeight: 500 }}>{PUBLIC_LABEL[mode]}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="switch">
                <span className="switch-text"><b>On the active roster</b><small>Turn off for a player who has left. Their stats stay.</small></span>
                <input type="checkbox" name="active" defaultChecked={p.active} />
              </label>
              <Submit busy="Saving…">Save player</Submit>
            </ActionForm>

            <details className="fold danger">
              <summary>Delete this player</summary>
              <div className="fold-body">
                <ActionForm action={deletePlayer.bind(null, team.slug, p.id)} className="form">
                  <p className="hint">This removes {fullName(p) || 'the player'} from the team for good. For a player who has only left, turn off &ldquo;On the active roster&rdquo; instead.</p>
                  <Submit className="btn btn-danger" busy="Deleting…">Delete for good</Submit>
                </ActionForm>
              </div>
            </details>
          </>
        ) : (
          <p className="note note-plain">Shown publicly as <b>{publicName(p, p.public_name)}</b>. The organizer or head coach edits players.</p>
        )}
      </div>
    </>
  );
}
