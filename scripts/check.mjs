#!/usr/bin/env node
// Static checks for a no-build vanilla app. Written after v3.23 shipped with the
// entire Game setup section deleted — a text-range replacement whose end marker
// sat past the intended block. Syntax was fine, the deploy was fine, and Setup,
// Delete game and Reset game were dead in production for four versions.
//
// Run: node scripts/check.mjs   (exits non-zero on any finding)
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
const problems = [];
const fail = (msg) => problems.push(msg);

// Pages and the modules that drive them.
const PAGES = [
  { html: 'control.html', js: ['js/control.js'] },
  { html: 'overlay.html', js: ['js/overlay.js', 'js/anim.js', 'js/logic.js', 'js/clock.js'] },
  { html: 'recap.html', js: ['js/recap.js'] },
];
const ALL_JS = ['js/control.js', 'js/overlay.js', 'js/recap.js', 'js/logic.js', 'js/anim.js', 'js/audio.js',
  'js/config.js', 'js/supabase.js', 'js/clock.js', 'js/sync.js', 'js/football.js', 'js/soccer.js', 'js/volleyball.js', 'js/basketball.js'];

// Element handlers that must stay wired. Losing one is silent: the button simply
// stops doing anything, which is exactly how the v3.23 regression presented.
const REQUIRED_HANDLERS = [
  'setup-btn', 'setup-save', 'setup-cancel', 'delete-game', 'reset-game',
  'new-game-btn', 'back-btn', 'logout-btn', 'undo-btn', 'signup-btn',
  'btn-ball', 'btn-strike', 'btn-foul', 'btn-out', 'btn-run', 'btn-batter', 'btn-endhalf',
  'onair-open', 'onair-done', 'air-clear', 'play-just-out', 'play-cancel', 'rs-record', 'rs-back', 'hit-1b', 'fx-replay', 'fx-rally', 'copy-url-btn', 'obs-ui', 'rotate-url-btn',
];

// ---- 1. Syntax ------------------------------------------------------------
// These are ES modules; node --check treats a bare .js as CommonJS, so copy to .mjs.
const tmp = mkdtempSync(join(tmpdir(), 'sbcheck-'));
for (const f of ALL_JS) {
  const dest = join(tmp, basename(f, '.js') + '.mjs');
  writeFileSync(dest, read(f));
  try {
    execFileSync(process.execPath, ['--check', dest], { stdio: 'pipe' });
  } catch (e) {
    fail(`${f}: syntax error\n    ${String(e.stderr || e).split('\n').slice(0, 3).join('\n    ')}`);
  }
}

// Strip comments and string bodies before scanning for identifiers — prose in a
// comment otherwise reads as a call ("broadcast (all sports)" -> broadcast()).
function noComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 '); // line comments, sparing https://
}
// Identifier scanning also drops string bodies; id lookups must keep them.
function code(src) {
  return noComments(src)
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

// ---- 2. Every element a module reaches for must exist in its page ---------
for (const { html, js } of PAGES) {
  // Ids come from the page and from markup the modules build at runtime.
  const ids = new Set([
    ...[...read(html).matchAll(/id="([\w-]+)"/g)].map((m) => m[1]),
    ...js.flatMap((f) => [...read(f).matchAll(/id="([\w-]+)"/g)].map((m) => m[1])),
  ]);
  for (const f of js) {
    const src = noComments(read(f));
    const refs = new Set([
      ...[...src.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]),
      ...[...src.matchAll(/getElementById\('([\w-]+)'\)/g)].map((m) => m[1]),
    ]);
    for (const id of refs) if (!ids.has(id)) fail(`${f}: uses #${id}, which is not in ${html}`);
  }
}

// ---- 3. Required handlers are still wired --------------------------------
const control = noComments(read('js/control.js'));
for (const id of REQUIRED_HANDLERS) {
  const wired = new RegExp(`\\$\\('${id}'\\)(?:\\.\\w+)*\\.(?:onclick|onchange|oninput|addEventListener)`).test(control);
  if (!wired) fail(`js/control.js: #${id} has no handler — that control is dead`);
}

// ---- 4. Called but never defined -----------------------------------------
// The direct catch for a deleted block: fillSetup() was still called after its
// definition went. Only same-file local calls are considered.
const GLOBALS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'await',
  'console', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Date', 'Set', 'Map', 'Promise',
  'parseInt', 'parseFloat', 'isNaN', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch',
  'alert', 'confirm', 'prompt', 'document', 'window', 'localStorage', 'navigator', 'location', 'CustomEvent',
  'Event', 'Error', 'RegExp', 'addEventListener', 'requestAnimationFrame', 'structuredClone', 'URLSearchParams',
  'encodeURIComponent', 'decodeURIComponent', 'getComputedStyle', 'AudioContext', 'webkitAudioContext', 'Audio',
  'Infinity', 'undefined', 'null', 'true', 'false', 'super', 'this', 'new', 'else', 'do', 'try', 'in', 'of',
  'async', 'yield', 'delete', 'void', 'instanceof', 'case', 'throw']);
for (const f of ALL_JS) {
  const src = code(read(f));
  const defined = new Set([
    ...[...src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]),
    ...[...src.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/g)].map((m) => m[1]),
    ...[...src.matchAll(/import\s+\*\s+as\s+(\w+)/g)].map((m) => m[1]),
    ...[...src.matchAll(/import\s*\{([^}]+)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop())),
    ...[...src.matchAll(/(\w+)\s*(?:=>|\()/g)].filter(() => false).map((m) => m[1]), // placeholder
  ]);
  // locals: params and inline consts are noisy, so only flag calls to names that
  // look like module helpers (defined nowhere, not a global, not a method call).
  for (const m of src.matchAll(/(?<![.\w$])(\w+)\s*\(/g)) {
    const name = m[1];
    if (GLOBALS.has(name) || defined.has(name)) continue;
    if (/^[A-Z]/.test(name)) continue;                       // constructors / imported classes
    if (new RegExp(`\\b${name}\\s*[:,)=]`).test(src)) continue; // a parameter or property somewhere
    fail(`${f}: calls ${name}(), which is defined nowhere in the file`);
  }
}

// ---- report ---------------------------------------------------------------
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length > 1 ? 's' : ''}:\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('');
  process.exit(1);
}
console.log('✓ checks passed — syntax, element ids, required handlers, undefined calls');
