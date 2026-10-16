// Fetching a page a user named, from the server, without being turned against
// anything private: https only, a real public host name, every address it
// resolves to public, redirects followed by hand (at most two) and each one
// checked again, ten seconds and 2 MB at most. What is left is DNS rebinding
// between the check and the fetch, which a valid TLS certificate for the
// name also has to survive.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function privateAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

export async function checkUrl(raw: string | URL): Promise<URL | string> {
  let u: URL;
  try { u = new URL(raw); } catch { return 'That link is not a web address.'; }
  const host = u.hostname.replace(/\.$/, '').toLowerCase();
  if (u.protocol !== 'https:' || (u.port && u.port !== '443') || u.username || u.password) return 'Use a plain public https:// link.';
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(host)) return 'Use a public https:// link.';
  try {
    const addrs = await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) return 'That link points somewhere private.';
  } catch {
    return 'That web address could not be found.';
  }
  return u;
}

export async function fetchPublicPage(raw: string): Promise<string | { error: string }> {
  let url: URL | string = await checkUrl(raw);
  for (let hop = 0; hop < 3; hop++) {
    if (typeof url === 'string') return { error: url };
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'Scoreboard schedule import' }, redirect: 'manual' });
    } catch {
      return { error: 'Could not open that page.' };
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return { error: 'That page sent us nowhere.' };
      url = await checkUrl(new URL(next, url));
      continue;
    }
    if (!res.ok) return { error: `That page answered ${res.status}.` };
    const reader = res.body?.getReader();
    if (!reader) return { error: 'That page was empty.' };
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); break; }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
  return { error: 'That page redirects too many times.' };
}
