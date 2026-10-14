import type { Metadata } from 'next';
import Link from 'next/link';
import { requestReset } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';

export const metadata: Metadata = { title: 'Reset your password' };

export default function Forgot() {
  return (
    <main className="shell">
      <div className="front">
        <Link href="/" className="mark">SCOREBOARD</Link>
        <h1 className="disp h1">Reset your password</h1>
        <ActionForm action={requestReset} className="form">
          <label className="field"><span>Email</span>
            <input className="input" type="email" name="email" autoComplete="email" inputMode="email" required />
          </label>
          <Submit className="btn btn-primary btn-big" busy="Sending…">Email me a link</Submit>
        </ActionForm>
        <p className="sub">Remembered it? <Link className="link" href="/sign-in">Sign in</Link></p>
      </div>
    </main>
  );
}
