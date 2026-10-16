import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from '@/components/icons';
import { ScheduleImport } from '@/components/ScheduleImport';
import { aiOn, getAllowance } from '@/lib/ai-limit';
import { loadTeam } from '@/lib/data';
import { canWriteRecaps } from '@/lib/types';

export const metadata: Metadata = { title: 'Import a schedule' };
// Adding a tournament's games looks up each field's address for the weather.
export const maxDuration = 60;

export default async function ImportSchedule({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  if (!canWriteRecaps(role) || !aiOn(await getAllowance(supabase, team.id))) notFound();
  return (
    <div className="page" style={{ paddingTop: 6 }}>
      <div className="h-row" style={{ justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
        <Link href={`/t/${slug}/season`} aria-label="Back to the schedule" className="icon-btn" style={{ border: 0, marginLeft: -10 }}><ChevronLeft /></Link>
        <h1 className="disp h2">Import a schedule</h1>
      </div>
      <ScheduleImport slug={slug} teamId={team.id} />
    </div>
  );
}
