import { assignScorer, unassignScorer } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { Cross } from '@/components/icons';
import { ROLE_LABEL, canCoach, type Role, type StaffMember } from '@/lib/types';

// Who scores this game. Anyone on staff who can score can be put on it
// (scorer seats are for parents who score); they see it on Today and the
// calendar. The pad itself is open to every scoring seat, assigned or not.
export function ScorersCard({ slug, gameId, role, staff, scorers }: {
  slug: string; gameId: string; role: Role; staff: StaffMember[]; scorers: { user_id: string; name: string }[];
}) {
  const coach = canCoach(role);
  const free = staff.filter((m) => m.role !== 'media' && !scorers.some((s) => s.user_id === m.user_id));
  return (
    <section className="card pad">
      <div className="row-main">
        <span className="row-title">Scorers</span>
        <span className="row-meta">{scorers.length ? 'Down to score this game.' : 'Nobody is down to score this game yet.'}</span>
      </div>
      {scorers.length > 0 && (
        <div className="rows">
          {scorers.map((s) => (
            <div key={s.user_id} className="row">
              <span className="row-main"><span className="row-title">{s.name}</span></span>
              {coach && (
                <ActionForm action={unassignScorer.bind(null, slug, gameId, s.user_id)}>
                  <button type="submit" className="icon-btn" aria-label={`Take ${s.name} off this game`}><Cross /></button>
                </ActionForm>
              )}
            </div>
          ))}
        </div>
      )}
      {coach && free.length > 0 && (
        <ActionForm action={assignScorer.bind(null, slug, gameId)} className="form">
          <label className="field"><span>Put on this game</span>
            <select className="input" name="user" defaultValue="">
              <option value="" disabled>Pick someone on staff</option>
              {free.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name} · {ROLE_LABEL[m.role]}</option>)}
            </select>
          </label>
          <Submit className="btn btn-quiet btn-sm" busy="Adding…">Add scorer</Submit>
        </ActionForm>
      )}
      {coach && <p className="hint">A parent who scores needs a scorer seat first: Team &gt; People &gt; invite as Scorer. Scorer seats do not use the five staff seats.</p>}
    </section>
  );
}
