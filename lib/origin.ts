import { headers } from 'next/headers';

// Where this request came in, for links that leave the app (invite links, the
// address a confirmation email returns to).
export async function origin() {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const local = host.startsWith('localhost') || host.startsWith('127.');
  const proto = h.get('x-forwarded-proto') ?? (local ? 'http' : 'https');
  return `${proto}://${host}`;
}
