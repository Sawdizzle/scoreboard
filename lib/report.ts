// A crash on a phone or in OBS, sent to the server's log (and from there to
// whatever log drain the deployment has). Best effort: it never throws.
export function reportError(where: string, error: Error & { digest?: string }) {
  try {
    const body = JSON.stringify({
      where, message: String(error.message ?? error).slice(0, 500), digest: error.digest,
      stack: String(error.stack ?? '').slice(0, 2000), path: location.pathname.replace(/[0-9a-f-]{36}/gi, ':id'),
    });
    if (!navigator.sendBeacon?.('/api/client-error', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/client-error', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch { /* nothing to do */ }
}
