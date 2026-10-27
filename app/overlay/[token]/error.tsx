'use client';

import { useEffect } from 'react';
import { reportError } from '@/lib/report';

// The stream overlay crashed. Nothing is drawn (a blank layer beats an error
// on the broadcast), the crash is reported, and it tries again in 5 seconds.
export default function OverlayError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportError('overlay', error);
    const t = window.setTimeout(() => retry(), 5000);
    return () => window.clearTimeout(t);
  }, [error, retry]);
  return null;
}
