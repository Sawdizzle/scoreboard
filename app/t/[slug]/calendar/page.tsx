import type { Metadata } from 'next';
import Link from 'next/link';
import { CalendarList } from '@/components/hub/CalendarList';
import { Subscribe } from '@/components/hub/Subscribe';
import { Plus } from '@/components/icons';
import { calendarItems } from '@/lib/calendar';
import { listGameScorers, loadCalendar, loadMember } from '@/lib/data';
import { canCoach, isStaff } from '@/lib/types';

export const metadata: Metadata = { title: 'Calendar' };

export default async function Calendar({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, seat, userId } = await loadMember(slug);
  const cal = await loadCalendar(supabase, team, seat, userId);
  const items = calendarItems(cal.games, cal.events);
  const scorers = isStaff(seat) || seat === 'guardian' ? await listGameScorers(supabase, items.filter((i) => i.kind === 'game').map((i) => i.id)) : {};
  return (
    <>
      <div className="page-top">
        <div className="h-row">
          <h1 className="disp h1">Calendar</h1>
          {canCoach(seat) && <Link href={`/t/${slug}/calendar/new`} className="btn btn-primary btn-sm"><Plus /> Practice or event</Link>}
        </div>
      </div>
      <div className="page">
        <Subscribe slug={slug} />
        <CalendarList team={team} seat={seat} items={items} rsvps={cal.rsvps} roster={cal.roster} mine={cal.mine} scorers={scorers} />
      </div>
    </>
  );
}
