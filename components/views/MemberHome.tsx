import Link from 'next/link';
import { leaveTeam } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { CalendarList } from '@/components/hub/CalendarList';
import { NotifyCard, type NotifyPrefs } from '@/components/hub/NotifyCard';
import { Subscribe } from '@/components/hub/Subscribe';
import type { CalItem } from '@/lib/calendar';
import { staffName } from '@/lib/format';
import type { Message, Player, Rsvp, Seat, Team } from '@/lib/types';

type Notice = { id: number; body: string; created_at: string; author: string };

// Home for a parent or a fan: what is next, what the coaches said, and the two
// switches that make the app useful on a phone (notifications, the calendar).
export function MemberHome({ team, seat, items, rsvps, mine, news, league, prefs, scorers }: {
  team: Team; seat: Seat; items: CalItem[]; rsvps: Rsvp[]; mine: Player[]; news: Message[]; league: Notice[];
  prefs: NotifyPrefs; scorers: Record<string, { name: string }[]>;
}) {
  const fan = seat === 'fan';
  const notices = [...league.map((l) => ({ ...l, from: `League · ${l.author}` })), ...news.map((m) => ({ id: m.id, body: m.body, created_at: m.created_at, from: m.author ?? 'Coach' }))]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 3);
  return (
    <div className="page" style={{ paddingTop: 16 }}>
      {mine.length > 0 && (
        <p className="sub">Parent of {mine.map((p) => `${staffName(p, team.name_format)}${p.number ? ` #${p.number}` : ''}`).join(', ')}</p>
      )}
      <NotifyCard slug={team.slug} prefs={prefs} fan={fan} />

      {!fan && (
        <>
          <div className="h-row"><h2 className="h-sec">Announcements</h2><Link href={`/t/${team.slug}/chat`} className="link">All messages</Link></div>
          {notices.length === 0 ? <p className="note note-plain">Nothing from the coaches yet.</p> : notices.map((n) => (
            <div key={`${n.from}${n.id}`} className="msg notice" style={{ maxWidth: '100%' }}>
              <span className="msg-meta"><b>{n.from}</b></span>
              <div className="msg-body">{n.body}</div>
            </div>
          ))}
        </>
      )}

      <div className="h-row"><h2 className="h-sec">Next up</h2><Link href={`/t/${team.slug}/calendar`} className="link">Calendar</Link></div>
      <CalendarList team={team} seat={seat} items={items} rsvps={rsvps} roster={mine} mine={mine} scorers={scorers} limit={4} />
      <Subscribe slug={team.slug} />

      <p className="sub" style={{ textAlign: 'center' }}>
        <Link href={`/team/${team.slug}`} className="link">Scores, stats and roster</Link>
      </p>
      <details className="fold danger">
        <summary>{fan ? 'Unfollow' : 'Leave the team'}</summary>
        <div className="fold-body">
          <ActionForm action={leaveTeam.bind(null, team.slug)}>
            <Submit className="btn btn-danger" busy="Leaving…">{fan ? 'Stop following' : 'Leave the team'}</Submit>
          </ActionForm>
        </div>
      </details>
    </div>
  );
}
