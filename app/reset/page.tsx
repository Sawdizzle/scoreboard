import type { Metadata } from 'next';
import Link from 'next/link';
import { setPassword } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { getUserId } from '@/lib/data';

export const metadata: Metadata = { title: 'Choose a new password' };

// Where the reset email lands, signed in by /auth/callback.
export default async function Reset() {
  const signedIn = !!(await getUserId());
  return (
    <main className="shell">
      <div className="front">
        <Link href="/" className="mark">SCOREBOARD</Link>
        <h1 className="disp h1">Choose a new password</h1>
        {signedIn ? (
          <ActionForm action={setPassword} className="form">
            <label className="field"><span>New password · 8 characters or more</span>
              <input className="input" type="password" name="password" autoComplete="new-password" minLength={8} required />
            </label>
            <Submit className="btn btn-primary btn-big" busy="Saving…">Save password</Submit>
          </ActionForm>
        ) : (
          <p className="sub">This link has expired or was already used. <Link className="link" href="/forgot">Ask for a new one</Link>.</p>
        )}
      </div>
    </main>
  );
}
