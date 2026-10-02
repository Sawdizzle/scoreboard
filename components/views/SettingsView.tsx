import { deleteTeam, updateTeam } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { TeamFields } from '@/components/TeamFields';
import { canEditTeam, canManageSeats, type Role, type Team } from '@/lib/types';

export function SettingsView({ team, role }: { team: Team; role: Role }) {
  if (!canEditTeam(role)) {
    return <div className="page"><p className="note note-plain">The organizer or head coach edits the team&rsquo;s name, abbreviation and colour.</p></div>;
  }
  return (
    <div className="page">
      <ActionForm action={updateTeam.bind(null, team.slug)} className="form">
        <TeamFields name={team.name} abbr={team.abbr} color={team.color} ageGroup={team.age_group ?? ''} />
        <Submit busy="Saving…">Save team</Submit>
      </ActionForm>
      {canManageSeats(role) && (
        <details className="fold danger">
          <summary>Delete this team</summary>
          <div className="fold-body">
            <ActionForm action={deleteTeam.bind(null, team.slug)} className="form">
              <p className="hint">This deletes {team.name}, its roster, its seasons and every staff seat. It cannot be undone.</p>
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
