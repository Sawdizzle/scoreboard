// The release the stream page is running, so a page left open in OBS can see
// a newer one and reload itself (components/overlay/Overlay.tsx).
export const dynamic = 'force-dynamic';

export function GET() {
  const v = process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'dev';
  return new Response(v, { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}
