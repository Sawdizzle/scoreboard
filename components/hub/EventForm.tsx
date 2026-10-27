import { DateTimeField } from '@/components/LocalTime';
import { EVENT_LABEL, type EventKind, type TeamEvent } from '@/lib/types';

const KINDS: EventKind[] = ['practice', 'meeting', 'event'];

// What a practice or event needs: what, when, where. A game is made from
// Season, where its opponent and rules are set.
export function EventFields({ e }: { e?: TeamEvent }) {
  return (
    <>
      <fieldset>
        <legend className="legend">What</legend>
        <div className="pills">
          {KINDS.map((k) => (
            <label key={k} className="pill wide">
              <input type="radio" name="kind" value={k} defaultChecked={(e?.kind ?? 'practice') === k} />
              <span>{EVENT_LABEL[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field"><span>Title · optional</span>
        <input className="input" name="title" defaultValue={e?.title ?? ''} maxLength={80} placeholder="Practice" autoComplete="off" />
      </label>
      <div className="field-row">
        <DateTimeField name="starts_at" value={e?.starts_at ?? null} label="Starts" />
        <DateTimeField name="ends_at" value={e?.ends_at ?? null} label="Ends · optional" />
      </div>
      <label className="field"><span>Place · optional</span>
        <input className="input" name="location" defaultValue={e?.location ?? ''} maxLength={80} placeholder="Field 2, Kerman Park" />
      </label>
      <label className="field"><span>Address · optional, for directions</span>
        <input className="input" name="address" defaultValue={e?.address ?? ''} maxLength={200} autoComplete="street-address" />
      </label>
      <label className="field"><span>Notes for families · optional</span>
        <textarea className="input textarea" name="notes" defaultValue={e?.notes ?? ''} maxLength={1000} rows={3} placeholder="Bring water, glove and helmet." />
      </label>
    </>
  );
}
