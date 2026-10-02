import Link from 'next/link';
import { addPlayer, pastePlayers } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { ChevronRight, Plus } from '@/components/icons';
import { PlayerFields } from '@/components/PlayerFields';
import { byJersey, fullName } from '@/lib/format';
import { canEditTeam, type Player, type Role, type Team } from '@/lib/types';

export function RosterView({ team, role, players }: { team: Team; role: Role; players: Player[] }) {
  const edit = canEditTeam(role);
  const active = players.filter((p) => p.active).sort(byJersey);
  const inactive = players.filter((p) => !p.active).sort(byJersey);
  const row = (p: Player) => (
    <Link key={p.id} href={`/t/${team.slug}/player/${p.id}`} className={`row${p.active ? '' : ' off'}`}>
      <span className="jersey">{p.number || '–'}</span>
      <span className="row-main">
        <span className="row-title">{fullName(p) || `No. ${p.number}`}{p.positions.length > 0 && <small>{p.positions.join(' · ')}</small>}</span>
      </span>
      <span className="row-meta" style={{ width: 44, textAlign: 'right' }}>{p.bats || p.throws ? `${p.bats ?? '–'}/${p.throws ?? '–'}` : ''}</span>
      <span className="chev"><ChevronRight /></span>
    </Link>
  );
  return (
    <div className="page">
      {players.length === 0 ? (
        <div className="card empty">
          <b>No players yet</b>
          {edit ? 'Add them one at a time, or paste the whole list from a text or a lineup card.' : 'The organizer or head coach adds the roster.'}
        </div>
      ) : (
        <section>
          <div className="col-head">
            <span style={{ flex: '0 0 40px' }}>No.</span>
            <span style={{ flex: 1 }}>Player</span>
            <span style={{ width: 44, textAlign: 'right' }}>B/T</span>
            <span style={{ width: 16 }} />
          </div>
          <div className="rows">{active.map(row)}</div>
          {inactive.length > 0 && (
            <>
              <div className="col-head" style={{ paddingTop: 18 }}><span>Not on the active roster</span></div>
              <div className="rows">{inactive.map(row)}</div>
            </>
          )}
        </section>
      )}

      {edit && (
        <div className="folds">
          <details className="fold" open={players.length === 0}>
            <summary><span className="plus"><Plus /></span>Add player</summary>
            <div className="fold-body">
              <ActionForm action={addPlayer.bind(null, team.slug)} className="form" resetOnOk>
                <PlayerFields />
                <Submit busy="Adding…">Add to roster</Submit>
              </ActionForm>
            </div>
          </details>
          <details className="fold">
            <summary><span className="plus"><Plus /></span>Paste a list</summary>
            <div className="fold-body">
              <ActionForm action={pastePlayers.bind(null, team.slug)} className="form" resetOnOk>
                <label className="field"><span>One player per line</span>
                  <textarea className="textarea" name="list" placeholder={'7 Ava Reyes SS\n#12 Ben Ortiz (P)\n3. Cy Park - CF\nFinn Moore\n21'} required />
                </label>
                <p className="hint">A number first, then the name, then a position if you have one. Any of the three can be missing.</p>
                <Submit busy="Adding…">Add these players</Submit>
              </ActionForm>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
