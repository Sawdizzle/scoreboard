import type { Metadata } from 'next';
import Link from 'next/link';
import { createOrg } from '@/app/hub-actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { requireUserId } from '@/lib/data';

export const metadata: Metadata = { title: 'New league' };

export default async function NewOrg() {
  await requireUserId('/org/new');
  return (
    <main className="shell">
      <div className="page-top"><Link href="/t" className="link">Your teams</Link><h1 className="disp h1">New league</h1></div>
      <div className="page">
        <p className="lede">A league runs above its teams: its admins act as team admin on every team in it, post to every family at once, and see one calendar for the league.</p>
        <ActionForm action={createOrg} className="form">
          <label className="field"><span>League name</span>
            <input className="input" name="name" maxLength={80} required placeholder="Sanger Spring League" autoComplete="organization" />
          </label>
          <label className="field"><span>Short address · optional</span>
            <input className="input" name="slug" maxLength={60} placeholder="ssl" autoComplete="off" />
          </label>
          <Submit className="btn btn-primary btn-big" busy="Creating…">Create the league</Submit>
        </ActionForm>
      </div>
    </main>
  );
}
