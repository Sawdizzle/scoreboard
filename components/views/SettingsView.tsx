import { deleteTeam } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { BrandEditor } from '@/components/BrandEditor';
import { CopyLink } from '@/components/CopyLink';
import { canEditTeam, canManageSeats, type Role, type Team } from '@/lib/types';

export function SettingsView({ team, role, welcome, publicUrl }: { team: Team; role: Role; welcome?: boolean; publicUrl?: string }) {
  return (
    <div className="page">
      <BrandEditor team={team} canEdit={canEditTeam(role)} welcome={welcome} />
      {publicUrl && (
        <section className="card pad">
          <h2>Public team page</h2>
          <p className="hint">Schedule, live scores, box scores, roster and season stats, for families and fans. No account needed. Players appear under the name chosen on their player screen.</p>
          <CopyLink url={publicUrl} label="Public team page link" />
        </section>
      )}
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
