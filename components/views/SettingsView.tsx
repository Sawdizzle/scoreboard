import { deleteTeam, resetStreamLink, saveSponsor, saveStreamBug } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { BrandEditor } from '@/components/BrandEditor';
import { CopyLink } from '@/components/CopyLink';
import { LookPicker } from '@/components/LookPicker';
import { brandOf } from '@/components/TeamBrand';
import { LayoutControls } from '@/components/LayoutControls';
import type { Feed, Look } from '@/lib/onair';
import { canEditTeam, canManageSeats, type Role, type Team } from '@/lib/types';

// streamUrl is the team's Browser Source link, for any seat: whoever runs the
// broadcast sets up OBS, and that is often not the organizer.
export type SponsorInfo = { name: string | null; line: string | null; logo: string | null; bugText?: string | null; bugUrl?: string | null };
export function SettingsView({ team, role, welcome, streamUrl, look, publicUrl, sponsor, layout }: {
  team: Team; role: Role; welcome?: boolean; streamUrl?: string; look?: Look; publicUrl?: string; sponsor?: SponsorInfo; layout?: Feed['layout'];
}) {
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
      {streamUrl && (
        <section className="card pad">
          <h2>Stream scorebug</h2>
          <p className="hint">Add this link to OBS (or any streaming software) as a Browser Source, 1920 wide by 1080 high. It shows the game being scored on the pad, with a clear background.</p>
          <CopyLink url={streamUrl} label="Browser Source link" />
          <p className="hint">Anyone with the link can watch the scorebug. Share it only with whoever runs the stream.</p>
          <h3>Look</h3>
          <p className="hint">Pressbox and Classic show the batter&rsquo;s season line on the scorebug; Classic is the compact broadcast bug, and everything on it moves with the game. The others are Scoreboard&rsquo;s animated bugs: they play each hit, strikeout and home run, and show the batter by name. Stat cards work with every look.</p>
          <LookPicker teamId={team.id} brand={brandOf(team)} initial={look ?? 'pressbox'} />
          <h3>Size and position</h3>
          <p className="hint">The scorebug and the stat cards each have their own size. Move a slider with the stream in view; it follows in a few seconds. The QR code has its own controls in On Air.</p>
          <LayoutControls teamId={team.id} initial={layout ?? null} />
          {canEditTeam(role) && (
            <details className="fold">
              <summary>Sponsor</summary>
              <div className="fold-body">
                <ActionForm action={saveSponsor.bind(null, team.slug)} className="form">
                  <p className="hint">Shown as a card from On Air in the pad: &ldquo;Brought to you by&rdquo;, the logo, the name and a line under it. Clear the name to remove the sponsor.</p>
                  <label className="field"><span>Sponsor name</span>
                    <input className="input" name="sponsor_name" defaultValue={sponsor?.name ?? ''} maxLength={40} autoComplete="off" />
                  </label>
                  <label className="field"><span>Line under it</span>
                    <input className="input" name="sponsor_line" defaultValue={sponsor?.line ?? ''} maxLength={60} autoComplete="off" placeholder="Cold treats on Elm Street" />
                  </label>
                  <label className="field"><span>Logo (PNG, WebP or JPEG, under 1 MB)</span>
                    <input className="input" type="file" name="sponsor_logo" accept="image/png,image/webp,image/jpeg" />
                  </label>
                  {sponsor?.logo && <label className="switch"><span className="switch-text"><b>Remove the current logo</b></span><input type="checkbox" name="remove_sponsor_logo" /></label>}
                  <Submit busy="Saving…">Save sponsor</Submit>
                </ActionForm>
              </div>
            </details>
          )}
          {canEditTeam(role) && (
            <details className="fold">
              <summary>Channel bug</summary>
              <div className="fold-body">
                <ActionForm action={saveStreamBug.bind(null, team.slug)} className="form">
                  <p className="hint">A small line that stays in the bottom right corner of the stream all game, like a TV channel&rsquo;s. Add a link and On Air gets a QR code you can turn on, size, place and fade. Clear both to remove it.</p>
                  <label className="field"><span>Line in the corner</span>
                    <input className="input" name="bug_text" defaultValue={sponsor?.bugText ?? ''} maxLength={40} autoComplete="off" placeholder="Streamed by sawman.app" />
                  </label>
                  <label className="field"><span>Link for the QR code</span>
                    <input className="input" name="bug_url" defaultValue={sponsor?.bugUrl ?? ''} maxLength={200} autoComplete="off" inputMode="url" placeholder="sawman.app" />
                  </label>
                  <Submit busy="Saving…">Save channel bug</Submit>
                </ActionForm>
              </div>
            </details>
          )}
          {canEditTeam(role) && (
            <details className="fold danger">
              <summary>Make a new stream link</summary>
              <div className="fold-body">
                <ActionForm action={resetStreamLink.bind(null, team.slug)} className="form">
                  <p className="hint">For when the link has got out. The old link stops working at once, and OBS shows nothing until you paste in the new one.</p>
                  <Submit className="btn btn-danger" busy="Making…">Make a new link</Submit>
                </ActionForm>
              </div>
            </details>
          )}
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
