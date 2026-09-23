// The modules under js/ are ES modules, but there is no package.json (on
// purpose — nothing here compiles), so Node reads a bare .js as CommonJS and
// chokes on `export`. Copy them to .mjs in a temp dir and import from there:
// the same trick check.mjs uses for its syntax pass, in one place for the tests.
//
// Every js/*.js is copied, with its relative imports ('./roster.js') pointed at
// the copies, so a rules module may import another rules module. A module that
// imports the network client (supabase.js, and the CDN bundle behind it) is not
// something to load here; the tests stay on the pure layer.
import { readFileSync, writeFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'sbtest-'));
for (const f of readdirSync(join(root, 'js')).filter((n) => n.endsWith('.js'))) {
  const src = readFileSync(join(root, 'js', f), 'utf8')
    .replace(/(from\s+['"]\.\/[\w-]+)\.js(['"])/g, '$1.mjs$2');
  writeFileSync(join(dir, basename(f, '.js') + '.mjs'), src);
}

export function loadModule(rel) {
  return import(join(dir, basename(rel, '.js') + '.mjs'));
}
