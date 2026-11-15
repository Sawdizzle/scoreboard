// Which paths run the proxy (and so wait on getClaims()) and which skip it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unstable_doesMiddlewareMatch as runs } from 'next/experimental/testing/server.js';
import { readFileSync } from 'node:fs';

// Next reads proxy.ts's config as a literal, and proxy.ts imports next/server,
// which plain Node cannot load: so read the matcher from the source.
const src = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8');
const config = { matcher: [JSON.parse(`"${/matcher: \['(.+)'\]/.exec(src)![1]}"`) as string] };

const at = (url: string) => runs({ config, url });

test('the staff side and pages that ask who is signed in run the proxy', () => {
  for (const url of ['/', '/t', '/t/blue-steel/games', '/pad/blue-steel/123', '/team/blue-steel', '/org/ssl', '/sign-in', '/auth/callback', '/invite/abc'])
    assert.equal(at(url), true, url);
});

test('the overlay, /version, the API and public pages skip it', () => {
  for (const url of ['/overlay/0b1c2d3e-0000-4000-8000-000000000000', '/version', '/api/ai/ask', '/api/push/game',
    '/team/blue-steel/game/123', '/recap', '/privacy', '/help', '/help/ai', '/cal/team.ics', '/_next/static/x.js', '/logo.png'])
    assert.equal(at(url), false, url);
});

test('a lookalike path is not skipped by accident', () => {
  for (const url of ['/versions', '/recaps', '/overlays', '/apiary', '/team/blue-steel/games'])
    assert.equal(at(url), true, url);
});
