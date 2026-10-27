import type { Metadata } from 'next';
import Link from 'next/link';
import { signIn } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { safeNext } from '@/lib/data';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  return (
    <main className="shell">
      <div className="front">
        <Link href="/" className="wordmark">SCOREBOARD</Link>
        <h1 className="disp h1">Sign in</h1>
        <ActionForm action={signIn} className="form">
          <input type="hidden" name="next" value={next} />
          <label className="field"><span>Email</span>
            <input className="input" type="email" name="email" autoComplete="email" inputMode="email" required />
          </label>
          <label className="field"><span>Password</span>
            <input className="input" type="password" name="password" autoComplete="current-password" required />
          </label>
          <Submit className="btn btn-primary btn-big" busy="Signing in…">Sign in</Submit>
        </ActionForm>
        <p className="sub"><Link className="link" href="/forgot">Forgot your password?</Link></p>
        <p className="sub">New here? <Link className="link" href={`/sign-up?next=${encodeURIComponent(next)}`}>Create an account</Link></p>
      </div>
    </main>
  );
}
