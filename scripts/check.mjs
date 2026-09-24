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
  { html: 'control.html', js: ['js/control.js', 'js/pads.js', 'js/obs-pad.js', 'js/lobby.js', 'js/setup.js', 'js/field.js', 'js/setup.js'] },
  { html: 'overlay.html', js: ['js/overlay.js', 'js/starting.js', 'js/weather.js', 'js/storm.js', 'js/anim.js', 'js/anim-bug.js', 'js/scenes-elevated.js', 'js/logic.js', 'js/roster.js', 'js/clock.js'] },
  { html: 'recap.html', js: ['js/recap.js'] },
];
const ALL_JS = ['js/control.js', 'js/overlay.js', 'js/recap.js', 'js/logic.js', 'js/roster.js', 'js/anim.js', 'js/audio.js',
  'js/config.js', 'js/supabase.js', 'js/clock.js', 'js/sync.js', 'js/pads.js', 'js/obs-pad.js', 'js/lobby.js', 'js/setup.js', 'js/field.js', 'js/football.js', 'js/soccer.js', 'js/volleyball.js', 'js/basketball.js', 'js/starting.js', 'js/weather.js', 'js/storm.js', 'js/anim-bug.js', 'js/scenes-elevated.js'];

// Element handlers that must stay wired. Losing one is silent: the button simply
// stops doing anything, which is exactly how the v3.23 regression presented.
const REQUIRED_HANDLERS = [
  'setup-open', 'setup-back', 'delete-game', 'reset-game',
  'new-game-btn', 'back-btn', 'logout-btn', 'undo-btn', 'signup-btn',
  'btn-ball', 'btn-strike', 'btn-foul', 'btn-inplay', 'btn-batter', 'pad-dia', 'runners-done', 'field-open', 'field-back', 'fv-tab-away', 'fv-tab-home', 'btn-endhalf',
  'onair-open', 'onair-done', 'air-clear', 'tk-show', 'tk-hide', 'tk-chip-x', 'pz-show', 'pz-hide', 'pz-restart', 'pz-minus', 'pz-plus', 'play-just-out', 'k3-swing', 'k3-look', 'k3-dropped', 'k3-cancel', 'btn-more', 'more-hbp', 'more-ci', 'more-ibb', 'more-balk', 'more-cancel', 'pick-back', 'play-cancel', 'rs-record', 'rs-back', 'fx-replay', 'fx-rally', 'copy-url-btn', 'obs-ui', 'rotate-url-btn',
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
const control = ['js/control.js', 'js/pads.js', 'js/obs-pad.js', 'js/lobby.js', 'js/setup.js', 'js/field.js'].map((f) => noComments(read(f))).join('\n');
for (const id of REQUIRED_HANDLERS) {
  const wired = new RegExp(`\\$\\('${id}'\\)(?:\\.\\w+)*\\.(?:onclick|onchange|oninput|addEventListener)`).test(control);
  if (!wired) fail(`control modules: #${id} has no handler — that control is dead`);
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
    // Destructured names — const { a, b } = ctx, for (const [id, run] of rows) —
    // and object-literal methods, render(g) { … }, which define as much as a const.
    ...[...src.matchAll(/(?:const|let|var)\s*[{[]([^}\]]+)[}\]]\s*(?:=|of\b)/g)]
      .flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s*[:=]\s*/).pop().replace(/^\.\.\./, ''))),
    ...[...src.matchAll(/(?:^|\n)\s+(\w+)\s*\([^)\n]*\)\s*\{/g)].map((m) => m[1]),
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

// ---- 5. A pad module uses only what control.js hands it ------------------
// The pad's modules (pads, obs-pad, lobby, setup, field) are built from
// control.js with a context object. A name from control.js's own scope that a
// module uses but was not given is a ReferenceError the moment that code runs —
// which, for a screen behind a login, is on the field. Catch it here.
{
  // Template literals stay in: `${teamAbbr(s)}` is a use, and blanking it is
  // how the first version of this check missed exactly that.
  const plain = (src) => noComments(src)
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    // A template literal keeps its ${…} expressions and drops its prose.
    .replace(/`(?:\\.|[^`\\])*`/g, (t) => ' ' + [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1]).join(' ; ') + ' ');
  const ctl = code(read('js/control.js'));
  const outer = new Set([
    ...[...ctl.matchAll(/(?:^|\n)(?:async\s+)?(?:function|const|let)\s+(\w+)/g)].map((m) => m[1]),
    ...[...ctl.matchAll(/(?:^|\n)const\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim())),
  ]);
  for (const f of ['js/pads.js', 'js/obs-pad.js', 'js/lobby.js', 'js/setup.js', 'js/field.js']) {
    const src = plain(read(f));
    const own = new Set([
      ...[...src.matchAll(/(?:function|const|let|var)\s+(\w+)/g)].map((m) => m[1]),
      ...[...src.matchAll(/(?:const|let|var)\s*[{[]([^}\]]+)[}\]]/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s*[:=]\s*/).pop().replace(/^\.\.\./, ''))),
      ...[...src.matchAll(/import\s*\{([^}]+)\}/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop())),
      ...[...src.matchAll(/import\s+\*\s+as\s+(\w+)/g)].map((m) => m[1]),
      ...[...src.matchAll(/\(([^()]*)\)\s*=>/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s*=\s*/)[0])),
      ...[...src.matchAll(/(\w+)\s*=>/g)].map((m) => m[1]),
      ...[...src.matchAll(/function\s*\w*\s*\(([^)]*)\)/g)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s*=\s*/)[0])),
    ]);
    for (const name of outer) {
      if (!name || own.has(name)) continue;
      if (new RegExp(`(?<![.\\w$'"-])${name.replace('$', '\\$')}(?![\\w$:])`).test(src)) {
        fail(`${f}: uses ${name} from control.js without receiving it in its context`);
      }
    }
  }
}

// ---- 6. The preconnect hints name the project config.js uses -------------
// A self-hoster changes SUPABASE_URL in js/config.js. A page still warming up a
// connection to somebody else's project costs every cold load on field LTE and
// says nothing about it, so the hint has to follow the config.
{
  const url = (read('js/config.js').match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
  for (const page of ['control.html', 'overlay.html', 'recap.html']) {
    for (const m of read(page).matchAll(/<link rel="preconnect" href="(https:\/\/[^"]+\.supabase\.co)"/g)) {
      if (m[1] !== url) fail(`${page}: preconnects to ${m[1]}, but js/config.js uses ${url}`);
    }
  }
}

// ---- 7. A screen wired before the screen it borrows from -----------------
// v4.13 shipped a blank pad. The Field screen was constructed one line above
// the Setup screen, and it takes closeSetup from it. Reading a const before
// its declaration is a TDZ ReferenceError, not undefined, so control.js threw
// at load and the page rendered nothing at all. node --check never runs the
// module, so nothing here saw it. Each create*() line hands the next module a
// bag of helpers; a bare name in that bag is read immediately, so it has to
// already exist. Arrow-wrapped ones (game: () => game) are read later and fine.
for (const f of ALL_JS) {
  const s = code(read(f));
  const wiring = [];                          // { names, args, at } per create*() line
  for (const m of s.matchAll(/const\s*\{([^}]*)\}\s*=\s*(create\w+)\(/g)) {
    let i = m.index + m[0].length, depth = 1;
    while (i < s.length && depth) { const c = s[i++]; if (c === '(') depth++; else if (c === ')') depth--; }
    wiring.push({ names: m[1].match(/[A-Za-z_$][\w$]*/g) || [], args: s.slice(m.index + m[0].length, i), at: m.index });
  }
  for (let a = 0; a < wiring.length; a++) {
    const later = new Map();                  // name -> the create*() line that makes it
    for (let b = a + 1; b < wiring.length; b++) for (const n of wiring[b].names) if (!later.has(n)) later.set(n, b);
    // Bare shorthand only: skip keys (name:), property reads (.name) and
    // anything inside an arrow body, which does not run until it is called.
    const bag = wiring[a].args.replace(/=>\s*\{[\s\S]*?\}/g, '=>{}').replace(/=>[^,]*/g, '=>0');
    for (const m of bag.matchAll(/(^|[,{(\s])([A-Za-z_$][\w$]*)(?=\s*[,}])/g)) {
      const b = later.get(m[2]);
      if (b === undefined) continue;
      const line = s.slice(0, wiring[a].at).split('\n').length;
      const declLine = s.slice(0, wiring[b].at).split('\n').length;
      fail(`${f}:${line}: takes ${m[2]}, which line ${declLine} does not create until later — the module throws at load`);
    }
  }
}

// ---- report ---------------------------------------------------------------
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem${problems.length > 1 ? 's' : ''}:\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('');
  process.exit(1);
}
console.log('✓ checks passed — syntax, element ids, required handlers, undefined calls, module contexts, load order, config');
