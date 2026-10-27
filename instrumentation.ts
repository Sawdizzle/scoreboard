import type { Instrumentation } from 'next';

// A server error as one tagged JSON line, so a log drain can alert on it the
// same way as a client crash (app/api/client-error).
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  console.error(JSON.stringify({
    tag: 'server-error', message: String(e?.message ?? err).slice(0, 500), digest: e?.digest,
    path: request.path.replace(/[0-9a-f-]{36}/gi, ':id'), method: request.method,
    route: context.routePath, kind: context.routerKind, type: context.routeType,
  }));
};
