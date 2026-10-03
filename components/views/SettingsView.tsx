import { deleteTeam } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { BrandEditor } from '@/components/BrandEditor';
import { CopyLink } from '@/components/CopyLink';
import { LookPicker } from '@/components/LookPicker';
import { brandOf } from '@/components/TeamBrand';
import type { Look } from '@/lib/onair';
import { canEditTeam, canManageSeats, type Role, type Team } from '@/lib/types';

// streamUrl is the team's Browser Source link, for any seat: whoever runs the
// broadcast sets up OBS, and that is often not the organizer.
export function SettingsView({ team, role, welcome, streamUrl, look }: { team: Team; role: Role; welcome?: boolean; streamUrl?: string; look?: Look }) {
  return (
    <div className="page">
      <BrandEditor team={team} canEdit={canEditTeam(role)} welcome={welcome} />
      {streamUrl && (
        <section className="card pad">
          <h2>Stream scorebug</h2>
          <p className="hint">Add this link to OBS (or any streaming software) as a Browser Source, 1920 wide by 1080 high. It shows the game being scored on the pad, with a clear background.</p>
          <CopyLink url={streamUrl} label="Browser Source link" />
          <p className="hint">Anyone with the link can watch the scorebug. Share it only with whoever runs the stream.</p>
          <h3>Look</h3>
          <p className="hint">Pressbox shows the batter&rsquo;s season line on the scorebug. The others are Scoreboard&rsquo;s animated bugs: they play each hit, strikeout and home run, and show the batter by name. Stat cards work with every look.</p>
          <LookPicker teamId={team.id} brand={brandOf(team)} initial={look ?? 'pressbox'} />
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
