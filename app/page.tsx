import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUserId } from '@/lib/data';
import { supabaseConfigured } from '@/lib/supabase/server';

export default async function Home() {
  if (supabaseConfigured && (await getUserId())) redirect('/t');
  return (
    <main className="shell">
      <div className="front">
        <span className="mark">SCOREBOARD</span>
        <span className="band" />
        <h1 className="disp">Score it once.</h1>
        <p className="lede">
          Build your team, set the lineup, score the game from your phone. The season stats
          and the scorebug on your stream come from the same taps.
        </p>
        {!supabaseConfigured && (
          <p className="note note-plain">
            Not connected to a database yet. Copy <code>.env.example</code> to <code>.env.local</code>, fill
            in the Supabase project URL and publishable key, and restart.
          </p>
        )}
        <div className="btn-row">
          <Link href="/sign-up" className="btn btn-primary btn-big">Create account</Link>
          <Link href="/sign-in" className="btn btn-quiet btn-big">Sign in</Link>
        </div>
      </div>
    </main>
  );
}
