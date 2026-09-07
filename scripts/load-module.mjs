// The modules under js/ are ES modules, but there is no package.json (on
// purpose — nothing here compiles), so Node reads a bare .js as CommonJS and
// chokes on `export`. Copy to .mjs in a temp dir and import that: the same
// trick check.mjs uses for its syntax pass, in one place for the tests.
//
// Only works for modules with no imports of their own, which is exactly the
// pure rules layer these tests are for.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'sbtest-'));

export function loadModule(rel) {
  const dest = join(dir, basename(rel, '.js') + '.mjs');
  writeFileSync(dest, readFileSync(join(root, rel), 'utf8'));
  return import(dest);
}
