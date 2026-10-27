import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cancelEvent, deleteEvent, updateEvent } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { EventFields } from '@/components/hub/EventForm';
import { ChevronLeft } from '@/components/icons';
import { getEvent, loadTeam } from '@/lib/data';
import { canCoach } from '@/lib/types';

export const metadata: Metadata = { title: 'Practice or event' };

export default async function EditEvent({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { supabase, team, role } = await loadTeam(slug);
  const e = await getEvent(supabase, team.id, id);
  if (!e) notFound();
  const coach = canCoach(role);
  return (
    <>
      <div className="page-top">
        <Link href={`/t/${slug}/calendar`} className="link"><ChevronLeft size={16} /> Calendar</Link>
        <h1 className="disp h1">{e.title}{e.canceled && ' (canceled)'}</h1>
      </div>
      <div className="page">
        {!coach ? (
          <p className="note note-plain">Coaches and team admins change the calendar.</p>
        ) : (
          <>
            <ActionForm action={updateEvent.bind(null, slug, e.id)} className="form">
              <EventFields e={e} />
              <label className="switch">
                <span className="switch-text"><b>Tell families about the change</b><small>A notification to everyone with them on.</small></span>
                <input type="checkbox" name="notify" defaultChecked />
              </label>
              <Submit busy="Saving…">Save</Submit>
            </ActionForm>
            <ActionForm action={cancelEvent.bind(null, slug, e.id, !e.canceled)}>
              <Submit className="btn btn-quiet btn-block" busy="Saving…">{e.canceled ? 'Put it back on' : 'Cancel it and tell families'}</Submit>
            </ActionForm>
            <details className="fold danger">
              <summary>Delete</summary>
              <div className="fold-body">
                <p className="hint">Deleting takes it off every calendar without a notice. To tell families, cancel it instead.</p>
                <ActionForm action={deleteEvent.bind(null, slug, e.id)}>
                  <Submit className="btn btn-danger" busy="Deleting…">Delete for good</Submit>
                </ActionForm>
              </div>
            </details>
          </>
        )}
      </div>
    </>
  );
}
