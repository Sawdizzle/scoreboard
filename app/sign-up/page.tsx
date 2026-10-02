import type { Metadata } from 'next';
import Link from 'next/link';
import { signUp } from '@/app/actions';
import { ActionForm, Submit } from '@/components/ActionForm';
import { safeNext } from '@/lib/data';

export const metadata: Metadata = { title: 'Create an account' };

export default async function SignUp({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  return (
    <main className="shell">
      <div className="front">
        <Link href="/" className="mark">PRESSBOX</Link>
        <h1 className="disp h1">Create an account</h1>
        <ActionForm action={signUp} className="form">
          <input type="hidden" name="next" value={next} />
          <label className="field"><span>Your name</span>
            <input className="input" type="text" name="name" autoComplete="name" maxLength={60} required />
          </label>
          <p className="hint">Shown on your team&rsquo;s staff list.</p>
          <label className="field"><span>Email</span>
            <input className="input" type="email" name="email" autoComplete="email" inputMode="email" required />
          </label>
          <label className="field"><span>Password · 8 characters or more</span>
            <input className="input" type="password" name="password" autoComplete="new-password" minLength={8} required />
          </label>
          <Submit className="btn btn-primary btn-big" busy="Creating…">Create account</Submit>
        </ActionForm>
        <p className="sub">Have an account? <Link className="link" href={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link></p>
      </div>
    </main>
  );
}
