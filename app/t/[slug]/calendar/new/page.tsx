import type { Metadata } from 'next';
import Link from 'next/link';
import { createEvent } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { EventFields } from '@/components/hub/EventForm';
import { ChevronLeft } from '@/components/icons';
import { loadTeam } from '@/lib/data';

export const metadata: Metadata = { title: 'New practice or event' };

export default async function NewEvent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await loadTeam(slug);
  return (
    <>
      <div className="page-top">
        <Link href={`/t/${slug}/calendar`} className="link"><ChevronLeft size={16} /> Calendar</Link>
        <h1 className="disp h1">New practice or event</h1>
      </div>
      <div className="page">
        <ActionForm action={createEvent.bind(null, slug)} className="form">
          <EventFields />
          <p className="hint">Families with notifications on are told right away.</p>
          <Submit className="btn btn-primary btn-big" busy="Adding…">Add to the calendar</Submit>
        </ActionForm>
      </div>
    </>
  );
}
