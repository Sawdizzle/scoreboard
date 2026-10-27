import { NextResponse, type NextRequest } from 'next/server';

// Where lib/report.ts sends a crash from the pad or the overlay. One JSON line
// per crash in the server log, tagged so a log drain can pick it out. Paths
// arrive with ids blanked; nothing else about the person is kept.
export async function POST(request: NextRequest) {
  const text = await request.text();
  if (text.length > 4096) return new NextResponse(null, { status: 413 });
  let r: Record<string, unknown>;
  try { r = JSON.parse(text); } catch { return new NextResponse(null, { status: 400 }); }
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  console.error(JSON.stringify({
    tag: 'client-error', where: s(r.where, 40), message: s(r.message, 500), digest: s(r.digest, 64),
    path: s(r.path, 200), stack: s(r.stack, 2000), ua: request.headers.get('user-agent')?.slice(0, 200),
  }));
  return new NextResponse(null, { status: 204 });
}
