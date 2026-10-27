import Link from 'next/link';
import { LocalTime } from '@/components/LocalTime';
import { Rsvp } from '@/components/hub/Rsvp';
import { answersFor, byDay, headCount, type CalItem } from '@/lib/calendar';
import { staffName } from '@/lib/format';
import { TZ } from '@/lib/schedule-import';
import { EVENT_LABEL, isStaff, type Player, type Rsvp as RsvpRow, type Seat, type Team } from '@/lib/types';

const dayTitle = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const mapsUrl = (q: string) => `https://maps.apple.com/?q=${encodeURIComponent(q)}`;

// The calendar, one day under another. Each game or event shows when and
// where; under it, a parent answers for their own players, and staff see the
// head count with every name. Scorers show on the games they are put on.
export function CalendarList({ team, seat, items, rsvps, roster, mine, scorers = {}, limit }: {
  team: Team; seat: Seat; items: CalItem[]; rsvps: RsvpRow[]; roster: Player[]; mine: Player[];
  scorers?: Record<string, { name: string }[]>; limit?: number;
}) {
  const staff = isStaff(seat);
  const shown = limit ? items.slice(0, limit) : items;
  const active = roster.filter((p) => p.active);
  const name = (p: Player) => staffName(p, team.name_format);
  if (!shown.length) {
    return <div className="card empty"><b>Nothing on the calendar</b>{staff ? 'Add a practice, or a game from Season.' : 'New games and practices show up here.'}</div>;
  }
  return (
    <div className="stack">
      {byDay(shown, TZ).map(({ day, items: list }) => (
        <section key={day} className="stack" style={{ gap: 8 }}>
          <span className="eyebrow">{dayTitle(day)}</span>
          {list.map((it) => {
            const answers = answersFor(it, rsvps);
            const count = headCount(answers, active.length);
            const href = it.kind === 'game'
              ? staff ? `/t/${team.slug}/games/${it.id}` : `/team/${team.slug}/game/${it.id}`
              : staff ? `/t/${team.slug}/calendar/${it.id}` : null;
            const where = [it.place, it.address].filter(Boolean).join(', ');
            const title = it.title;
            return (
              <article key={it.key} className={`card pad cal-item${it.canceled ? ' canceled' : ''}`}>
                <div className="cal-head">
                  <span className={`tag${it.kind === 'game' ? ' gold' : ''}`}>{it.kind === 'game' ? 'Game' : EVENT_LABEL[it.kind]}</span>
                  <span className="row-meta"><LocalTime iso={it.starts_at} mode="time" />{it.ends_at && <> to <LocalTime iso={it.ends_at} mode="time" /></>}</span>
                  {it.canceled && <span className="tag dim">Canceled</span>}
                  {it.status === 'live' && <span className="tag good">Live</span>}
                </div>
                <div className="row-main">
                  <span className="row-title">{href ? <Link href={href} className="cal-link">{title}</Link> : title}</span>
                  {where && <a className="row-meta link" href={mapsUrl(where)} target="_blank" rel="noreferrer">{where}</a>}
                  {it.kind === 'game' && scorers[it.id]?.length ? <span className="row-meta">Scoring: {scorers[it.id].map((s) => s.name).join(', ')}</span> : null}
                </div>
                {!it.canceled && mine.length > 0 && (
                  <Rsvp slug={team.slug} item={it.kind === 'game' ? { game: it.id } : { event: it.id }}
                    players={mine.map((p) => ({ id: p.id, name: name(p) }))} answers={answers} />
                )}
                {!it.canceled && (staff ? active.length > 0 : seat === 'guardian') && (
                  <details className="fold cal-count">
                    <summary>{count.yes} going · {count.maybe} maybe · {count.no} out{staff && ` · ${count.none} no answer`}</summary>
                    {staff && (
                      <div className="fold-body cal-names">
                        {(['yes', 'maybe', 'no'] as const).map((s) => {
                          const who = active.filter((p) => answers[p.id] === s);
                          return who.length ? <p key={s}><b>{s === 'yes' ? 'Going' : s === 'maybe' ? 'Maybe' : 'Out'}:</b> {who.map(name).join(', ')}</p> : null;
                        })}
                        {count.none > 0 && <p><b>No answer:</b> {active.filter((p) => !answers[p.id]).map(name).join(', ')}</p>}
                      </div>
                    )}
                  </details>
                )}
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
