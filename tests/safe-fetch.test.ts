// The schedule importer fetches only public https pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl } from '../lib/safe-fetch.ts';

test('private, local and odd addresses are refused before any fetch', async () => {
  for (const u of ['http://example.com/', 'https://localhost./x', 'https://127.0.0.1/', 'https://[::1]/', 'https://10.0.0.5/', 'https://metadata.google.internal./',
    'https://user:pw@example.com/', 'https://example.com:8443/', 'ftp://example.com/', 'not a url', 'https://intranet/']) {
    assert.equal(typeof (await checkUrl(u)), 'string', u);
  }
});
