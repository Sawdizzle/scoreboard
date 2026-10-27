// Only ever a path on this site: "/t/steel", never "//evil.example" or a URL.
// The string is parsed the way a browser would read it (tabs and newlines
// dropped, backslashes as slashes), so "/\t/evil.example" can't slip through.
const BASE = 'http://scoreboard.invalid';

export function safeNext(next: string | null | undefined, fallback = '/t') {
  if (!next || !next.startsWith('/') || /[\x00-\x1f\x7f]/.test(next)) return fallback;
  let u: URL;
  try { u = new URL(next, BASE); } catch { return fallback; }
  if (u.origin !== BASE) return fallback;
  return u.pathname + u.search + u.hash;
}
