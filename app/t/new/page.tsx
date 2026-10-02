import type { Metadata } from 'next';
import Link from 'next/link';
import { createTeam } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { ChevronLeft } from '@/components/icons';
import { TeamFields } from '@/components/TeamFields';
import { requireUserId } from '@/lib/data';
import { guessSeason } from '@/lib/format';

export const metadata: Metadata = { title: 'New team' };

export default async function NewTeam() {
  await requireUserId('/t/new');
  return (
    <main className="shell">
      <div className="page-top">
        <div className="h-row" style={{ justifyContent: 'flex-start', alignItems: 'center', gap: 2 }}>
          <Link href="/t" aria-label="Back to your teams" className="icon-btn" style={{ border: 0, marginLeft: -10 }}><ChevronLeft /></Link>
          <h1 className="disp h1">New team</h1>
        </div>
      </div>
      <div className="page">
        <ActionForm action={createTeam} className="form">
          <TeamFields />
          <label className="field"><span>First season</span>
            <input className="input" name="season" defaultValue={guessSeason()} maxLength={40} autoComplete="off" />
          </label>
          <p className="hint">You take the first of five staff seats, as the organizer. Players and the other seats come next.</p>
          <Submit className="btn btn-primary btn-big" busy="Creating…">Create team</Submit>
        </ActionForm>
      </div>
    </main>
  );
}
