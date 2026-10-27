import { createInvite, removeStaff, revokeInvite, setStaffRole } from '@/app/actions';
import { ActionForm, AutoSelect, Submit } from '@/components/ActionForm';
import { CopyLink } from '@/components/CopyLink';
import { Cross, Plus } from '@/components/icons';
import { shortDate } from '@/lib/format';
import { ROLES, ROLE_CAN, ROLE_LABEL, SCORER_SEATS, SEATS, canManageSeats, type Invite, type Role, type StaffMember, type Team } from '@/lib/types';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
// Organizer last: it is the seat that can do everything, and the least often handed out.
const INVITE_ROLES: Role[] = ['head_coach', 'coach', 'scorer', 'media', 'organizer'];
const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }));

export function StaffView({ team, role, me, staff, invites, origin }: {
  team: Team; role: Role; me: string; staff: StaffMember[]; invites: Invite[]; origin: string;
}) {
  const manage = canManageSeats(role);
  // Five coaching seats; scorers are counted apart, so a parent who scores never takes a coach's seat.
  const coaching = staff.filter((m) => m.role !== 'scorer'), coachLinks = invites.filter((i) => i.role !== 'scorer');
  const scorers = staff.length - coaching.length, scorerLinks = invites.length - coachLinks.length;
  const open = SEATS - coaching.length - coachLinks.length;
  const scorerOpen = SCORER_SEATS - scorers - scorerLinks;
  const bars = [...coaching.map(() => 'on'), ...coachLinks.map(() => 'held'), ...Array(Math.max(open, 0)).fill('')];
  return (
    <div className="page">
      <div className="seats">
        <div className="seat-bars" aria-hidden="true">{bars.map((b, i) => <span key={i} className={`seat-bar ${b}`} />)}</div>
        <span className="sub">
          {coaching.length} of {SEATS} staff seats filled{coachLinks.length > 0 && `, ${coachLinks.length} with a link out`}.
          {' '}{scorers} {scorers === 1 ? 'scorer' : 'scorers'}, counted apart (up to {SCORER_SEATS}).
        </span>
      </div>

      <div className="stack">
        {staff.map((m) => (
          <div key={m.user_id} className="card seat-card">
            <div className="seat">
              <span className="seat-face">{initials(m.display_name)}</span>
              <span className="row-main">
                <span className="row-title">{m.display_name}{m.user_id === me && <small>you</small>}</span>
              </span>
              {manage ? (
                <ActionForm action={setStaffRole.bind(null, team.slug, m.user_id)} className="seat-form">
                  <AutoSelect name="role" value={m.role} options={roleOptions} label={`Role for ${m.display_name}`} />
                </ActionForm>
              ) : (
                <span className={`tag${m.role === 'organizer' ? ' gold' : ''}`}>{ROLE_LABEL[m.role]}</span>
              )}
            </div>
            <div className="seat-sub">
              <span className="row-meta">{ROLE_CAN[m.role]}</span>
              {(manage || m.user_id === me) && (
                <ActionForm action={removeStaff.bind(null, team.slug, m.user_id)} className="seat-form">
                  <button type="submit" className="link">{m.user_id === me ? 'Leave team' : 'Remove'}</button>
                </ActionForm>
              )}
            </div>
          </div>
        ))}

        {invites.map((inv) => (
          <div key={inv.token} className="card open pad">
            <div className="seat" style={{ padding: 0 }}>
              <span className="seat-face open"><Plus size={18} /></span>
              <span className="row-main">
                <span className="row-title">{ROLE_LABEL[inv.role]} seat, link out</span>
                <span className="row-meta">Works once, until {shortDate(inv.expires_at)}</span>
              </span>
              <ActionForm action={revokeInvite.bind(null, team.slug, inv.token)}>
                <button type="submit" className="icon-btn" aria-label="Cancel this invite link"><Cross /></button>
              </ActionForm>
            </div>
            <CopyLink url={`${origin}/invite/${inv.token}`} />
          </div>
        ))}

        {manage && (open > 0 || scorerOpen > 0) && (
          <div className="card open pad">
            <div className="seat" style={{ padding: 0 }}>
              <span className="seat-face open"><Plus size={18} /></span>
              <span className="row-main">
                <span className="row-title">{open <= 0 ? 'Staff seats are full' : open === 1 ? 'One staff seat is open' : `${open} staff seats are open`}</span>
                <span className="row-meta">Pick a role, then send the link. Scorers, often parents, are put on the games they score.</span>
              </span>
            </div>
            <ActionForm action={createInvite.bind(null, team.slug)} className="form">
              <fieldset>
                <legend className="legend">Role</legend>
                <div className="pills">
                  {INVITE_ROLES.filter((r) => (r === 'scorer' ? scorerOpen > 0 : open > 0)).map((r) => (
                    <label key={r} className="pill">
                      <input type="radio" name="role" value={r} defaultChecked={r === (open > 0 ? 'coach' : 'scorer')} />
                      <span>{ROLE_LABEL[r]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <Submit busy="Making the link…">Make invite link</Submit>
            </ActionForm>
          </div>
        )}

        {!manage && open > 0 && <p className="note note-plain">{open === 1 ? 'One seat is' : `${open} seats are`} open. An organizer sends the invite links.</p>}
        {open <= 0 && coaching.length >= SEATS && <p className="note note-plain">All five staff seats are filled. Scorer seats are still open.</p>}
      </div>
    </div>
  );
}
