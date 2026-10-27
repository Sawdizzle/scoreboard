import { headers } from 'next/headers';

// Where links that leave the app point (invite links, the address a
// confirmation email returns to). SITE_URL, when set, is the only answer: a
// forwarded host header is the caller's to choose, so in production an email
// link must not trust it. Without SITE_URL (local dev), the request's host.
export async function origin() {
  const site = process.env.SITE_URL?.trim().replace(/\/+$/, '');
  if (site && /^https?:\/\/[^/]+$/.test(site)) return site;
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const local = host.startsWith('localhost') || host.startsWith('127.');
  const proto = h.get('x-forwarded-proto') ?? (local ? 'http' : 'https');
  return `${proto}://${host}`;
}
