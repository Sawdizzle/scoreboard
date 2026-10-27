'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { reportError } from '@/lib/report';

// The pad crashed. Plays not yet sent are kept on this phone (lib/play-queue)
// and go out when the pad opens again, so Try again loses nothing.
export default function PadError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { reportError('pad', error); }, [error]);
  return (
    <main className="shell">
      <div className="front">
        <h1 className="disp h1">The pad hit a problem</h1>
        <p className="lede">Plays that had not saved are kept on this phone and send when the pad opens again.</p>
        <div className="btn-row">
          <button className="btn btn-primary btn-big" type="button" onClick={() => retry()}>Try again</button>
          <Link href="/t" className="btn btn-quiet btn-big">Your teams</Link>
        </div>
      </div>
    </main>
  );
}
