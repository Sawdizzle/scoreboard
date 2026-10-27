import { deleteTeam, saveNameFormat, savePrivacy } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { BrandEditor } from '@/components/BrandEditor';
import { CopyLink } from '@/components/CopyLink';
import { AiUsageCard, type UsageRow } from '@/components/AiUsageCard';
import type { Allowance } from '@/lib/ai-limit';
import { formatName } from '@/lib/format';
import { canEditTeam, canManageSeats, NAME_FORMATS, type NameFormat, type Role, type Team } from '@/lib/types';

const FORMAT_LABEL: Record<NameFormat, string> = {
  full: 'Full name', initial_last: 'First initial, last name', last: 'Last name', first: 'First name', first_initial: 'First name, last initial',
};
const SAMPLE = { first_name: 'Alex', last_name: 'Raney' };

// One format for every player's name: pad, lineup, On Air, the stream and the
// public pages. A player's own public-name setting can only show less.
function NameFormatCard({ team, canEdit }: { team: Team; canEdit: boolean }) {
  return (
    <section className="card pad">
      <h2>Player names</h2>
      <p className="hint">How players are named on the pad, the lineup, On Air, the stream and the public pages. A player set to &ldquo;First name, last initial&rdquo; or &ldquo;Number only&rdquo; on their player screen keeps that on the stream and the public pages.</p>
      {canEdit ? (
        <ActionForm action={saveNameFormat.bind(null, team.slug)} className="form">
          <fieldset>
            <legend className="legend">Show names as</legend>
            <div className="stack" style={{ gap: 6 }}>
              {NAME_FORMATS.map((fmt) => (
                <label key={fmt} className="pill wide" style={{ display: 'flex' }}>
                  <input type="radio" name="name_format" value={fmt} defaultChecked={team.name_format === fmt} />
                  <span style={{ flex: 1, justifyContent: 'space-between', borderRadius: 12, gap: 12 }}>
                    <b>{formatName(SAMPLE, fmt)}</b><small style={{ fontWeight: 500 }}>{FORMAT_LABEL[fmt]}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Submit busy="Saving…">Save name format</Submit>
        </ActionForm>
      ) : (
        <p className="note note-plain">Names show as <b>{formatName(SAMPLE, team.name_format)}</b> ({FORMAT_LABEL[team.name_format].toLowerCase()}). The organizer or head coach changes this.</p>
      )}
    </section>
  );
}

export function SettingsView({ team, role, welcome, publicUrl, ai }: {
  team: Team; role: Role; welcome?: boolean; publicUrl?: string;
  // Organizers and coaches: the team's AI writing this month.
  ai?: { allowance: Allowance | null; rows: UsageRow[] } | null;
}) {
  return (
    <div className="page">
      <BrandEditor team={team} canEdit={canEditTeam(role)} welcome={welcome} />
      <NameFormatCard team={team} canEdit={canEditTeam(role)} />
      {publicUrl && (
        <section className="card pad">
          <h2>Public team page</h2>
          <p className="hint">Schedule, live scores, box scores, roster and season stats, for families and fans. No account needed. Players appear under the team&rsquo;s name format, or less where their player screen says so.</p>
          {team.private
            ? <p className="note note-plain">This team is <b>private</b>: the public page shows only its name, and the stream names no players.</p>
            : <CopyLink url={publicUrl} label="Public team page link" />}
          {canEditTeam(role) && (
            <ActionForm action={savePrivacy.bind(null, team.slug)} className="form">
              <label className="check"><input type="checkbox" name="private" defaultChecked={team.private} /> <span>Private team: hide the schedule, scores, stats and roster from anyone not on the staff</span></label>
              <Submit busy="Saving…">Save</Submit>
            </ActionForm>
          )}
        </section>
      )}
      {ai && <AiUsageCard allowance={ai.allowance} rows={ai.rows} />}
      {canManageSeats(role) && (
        <details className="fold danger">
          <summary>Delete this team</summary>
          <div className="fold-body">
            <ActionForm action={deleteTeam.bind(null, team.slug)} className="form">
              <p className="hint">This deletes {team.name}, its roster, its seasons, its games and every staff seat. It cannot be undone.</p>
              <label className="field"><span>Type the team name to confirm</span>
                <input className="input" name="confirm" autoComplete="off" placeholder={team.name} required />
              </label>
              <Submit className="btn btn-danger" busy="Deleting…">Delete team for good</Submit>
            </ActionForm>
          </div>
        </details>
      )}
    </div>
  );
}
