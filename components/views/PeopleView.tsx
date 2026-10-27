import Link from 'next/link';
import { approveMember, leaveOrg, linkGuardian, newFamilyLink, removeMember, saveFamilyApproval, unlinkGuardian } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { CopyLink } from '@/components/CopyLink';
import { Cross } from '@/components/icons';
import { StaffView } from '@/components/views/StaffView';
import { staffName } from '@/lib/format';
import { canCoach, canManageSeats, type Invite, type Member, type Org, type Player, type Role, type StaffMember, type Team } from '@/lib/types';

// Everyone on a team, in three groups: the staff who run it (five seats, and
// scorers apart), the families (parents, through the family link), and fans.
// No players: kids have no accounts, so nothing here messages a child.
export function PeopleView({ team, role, me, staff, invites, members, players, link, org, origin }: {
  team: Team; role: Role; me: string; staff: StaffMember[]; invites: Invite[]; members: Member[]; players: Player[];
  link: { token: string; require_approval: boolean } | null; org: Org | null; origin: string;
}) {
  const coach = canCoach(role);
  const pending = members.filter((m) => m.status === 'pending');
  const parents = members.filter((m) => m.role === 'guardian' && m.status === 'active');
  const fans = members.filter((m) => m.role === 'fan');
  const kid = (id: string) => players.find((p) => p.id === id);
  const kidName = (id: string) => { const p = kid(id); return p ? `${staffName(p, team.name_format)}${p.number ? ` #${p.number}` : ''}` : 'Player'; };
  return (
    <>
      <div className="page">
        <h2 className="h-sec">Staff</h2>
      </div>
      <StaffView team={team} role={role} me={me} staff={staff} invites={invites} origin={origin} />

      <div className="page">
        <h2 className="h-sec">Families</h2>
        {coach && link && (
          <div className="card pad">
            <div className="row-main">
              <span className="row-title">Family link</span>
              <span className="row-meta">Send it to your parents (the team email or group text). Each one picks their player, then {link.require_approval ? 'a coach approves them' : 'they are in'}.</span>
            </div>
            <CopyLink url={`${origin}/join/${link.token}`} label="Family link" />
            <ActionForm action={saveFamilyApproval.bind(null, team.slug)} className="form">
              <label className="switch">
                <span className="switch-text"><b>Approve each parent</b><small>A coach approves them before they see the team.</small></span>
                <input type="checkbox" name="approval" defaultChecked={link.require_approval} />
              </label>
              <Submit className="btn btn-quiet btn-sm" busy="Saving…">Save</Submit>
            </ActionForm>
            <ActionForm action={newFamilyLink.bind(null, team.slug)}>
              <Submit className="link" busy="Making a new link…">Make a new link (the old one stops working)</Submit>
            </ActionForm>
          </div>
        )}

        {pending.length > 0 && (
          <div className="stack">
            <span className="eyebrow gold">Waiting for approval · {pending.length}</span>
            {pending.map((m) => (
              <div key={m.user_id} className="card pad">
                <div className="row-main">
                  <span className="row-title">{m.display_name}</span>
                  <span className="row-meta">Parent of {m.players.map(kidName).join(', ') || 'no player picked'}</span>
                </div>
                {coach && (
                  <div className="btn-row">
                    <ActionForm action={approveMember.bind(null, team.slug, m.user_id)}><Submit busy="Approving…">Approve</Submit></ActionForm>
                    <ActionForm action={removeMember.bind(null, team.slug, m.user_id)}><Submit className="btn btn-quiet" busy="Declining…">Decline</Submit></ActionForm>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {parents.length === 0 && pending.length === 0 ? (
          <div className="card empty"><b>No parents yet</b>Send the family link. Parents get the calendar, RSVPs, announcements and the parents&rsquo; chat.</div>
        ) : parents.length > 0 && (
          <div className="card rows" style={{ padding: '4px 12px' }}>
            {parents.map((m) => (
              <div key={m.user_id} className="row" style={{ flexWrap: 'wrap' }}>
                <span className="row-main">
                  <span className="row-title">{m.display_name}</span>
                  <span className="row-meta chips-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {m.players.map((id) => (
                      <span key={id} className="tag">{kidName(id)}
                        {coach && (
                          <ActionForm action={unlinkGuardian.bind(null, team.slug, m.user_id, id)}>
                            <button type="submit" className="link" aria-label={`Unlink ${kidName(id)}`} style={{ marginLeft: 4 }}><Cross size={12} /></button>
                          </ActionForm>
                        )}
                      </span>
                    ))}
                  </span>
                </span>
                {coach && (
                  <details className="fold" style={{ width: '100%' }}>
                    <summary>Manage</summary>
                    <div className="fold-body">
                      <ActionForm action={linkGuardian.bind(null, team.slug, m.user_id)} className="form">
                        <label className="field"><span>Also parent of</span>
                          <select className="input" name="player" defaultValue="">
                            <option value="" disabled>Pick a player</option>
                            {players.filter((p) => p.active && !m.players.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{kidName(p.id)}</option>)}
                          </select>
                        </label>
                        <Submit className="btn btn-quiet btn-sm" busy="Linking…">Link player</Submit>
                      </ActionForm>
                      <ActionForm action={removeMember.bind(null, team.slug, m.user_id)}>
                        <Submit className="btn btn-danger btn-sm" busy="Removing…">Remove from the team</Submit>
                      </ActionForm>
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}

        <h2 className="h-sec">Fans · {fans.length}</h2>
        <p className="sub">Anyone can follow a public team from its <Link href={`/team/${team.slug}`} className="link">team page</Link>. Fans get game times and scores: no practices, addresses or chat.</p>
        {fans.length > 0 && coach && (
          <details className="fold">
            <summary>Who follows</summary>
            <div className="fold-body rows">
              {fans.map((m) => (
                <div key={m.user_id} className="row">
                  <span className="row-main"><span className="row-title">{m.display_name}</span></span>
                  <ActionForm action={removeMember.bind(null, team.slug, m.user_id)}>
                    <button type="submit" className="icon-btn" aria-label={`Remove ${m.display_name}`}><Cross /></button>
                  </ActionForm>
                </div>
              ))}
            </div>
          </details>
        )}

        <h2 className="h-sec">League</h2>
        {org ? (
          <div className="card pad">
            <div className="row-main">
              <span className="row-title">{org.name}</span>
              <span className="row-meta">League admins can run this team, post to every family, and see the league calendar.</span>
            </div>
            {canManageSeats(role) && (
              <ActionForm action={leaveOrg.bind(null, team.slug, null, team.id)}>
                <Submit className="link" busy="Leaving…">Take the team out of the league</Submit>
              </ActionForm>
            )}
          </div>
        ) : (
          <p className="note note-plain">Not in a league. A league admin sends a team link; the team admin opens it to join.</p>
        )}
      </div>
    </>
  );
}
