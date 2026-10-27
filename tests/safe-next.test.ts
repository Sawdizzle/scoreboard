// The post-login redirect stays on this site, whatever the link carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../lib/safe-next.ts';

test('safeNext refuses anything that leaves the site', () => {
  for (const bad of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '//evil.com', '/\\evil.com', '/\\/evil.com',
    'https://evil.com', 'evil.com', '', null, undefined, '/%0a/x\x00']) {
    assert.equal(safeNext(bad), '/t', JSON.stringify(bad));
  }
});

test('safeNext keeps paths on this site', () => {
  assert.equal(safeNext('/t/steel?x=1'), '/t/steel?x=1');
  assert.equal(safeNext('/invite/abc#top'), '/invite/abc#top');
  assert.equal(safeNext('/reset'), '/reset');
  assert.equal(safeNext(null, '/home'), '/home');
});
