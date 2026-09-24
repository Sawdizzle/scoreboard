// The animated scorebugs' reading of the game — bugs/kit.js `decide`.
//
// On air, an animated scorebug gets the game row after every tap on the pad,
// plus the stinger the pad attached, and has to work out what just happened:
// a hit, a walk, a strikeout, the third out, a home run. It had only ever been
// tried against made-up rows, and a made-up row is what hid that the pad's
// walk stinger ("webgem") was being ignored — walks never animated. These
// tests play games through the pad's own actions, with the stinger the pad
// really attaches, and replay a real game's event log.
//
// Run: node --test scripts/bugkit.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { loadModule } from './load-module.mjs';

const L = await loadModule('js/logic.js');
const { bugState } = await loadModule('js/anim-bug.js');

// kit.js is a plain browser script; everything but start() is pure.
const ctx = { window: {}, location: { search: '' }, URLSearchParams, structuredClone };
vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../bugs/kit.js', import.meta.url), 'utf8'), ctx);
const { decide } = ctx.window.BugKit;

// The stinger control.js commit() attaches to a play (keep in step with it).
const stinger = (res, before, after) => (L.isWalkoff(before, after) ? 'walkoff'
  : res.anim ? res.anim
  : (res.type === 'run' || (res.payload && res.payload.runs)) ? 'run'
  : res.type === 'strikeout' ? 'strikeout' : null);
// The pad's one-tap walk (control.js recordWalk).
const walk = (g) => { const w = L.computeWalk(g.bases);
  return { type: 'walk', patch: L.endPA(g, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(g, w.runs) }), payload: { runs: w.runs }, anim: 'webgem' }; };
// The pad's home run (control.js, kind HR).
const homer = (g) => { const runs = L.computeHomeRun(g.bases).runs;
  return { type: 'homerun', patch: L.homeRunPatch(g, runs), payload: { runs }, anim: 'homerun' }; };
const inPlay = (kind) => (g) => L.onPlay(g, { kind, dest: L.playDefaults(g, kind) });

const bases = (f, s, t) => ({ first: !!f, second: !!s, third: !!t });
const order = (n) => ({ batters: Array.from({ length: n }, (_, i) => ({ num: String(i + 1), name: 'B' + i })) });
const G = (over = {}) => ({
  id: 'g1', sport: 'baseball', half: 'top', inning: 1,
  balls: 0, strikes: 0, outs: 0, bases: bases(0, 0, 0),
  away_score: 0, home_score: 0, away_hits: 0, home_hits: 0, away_errors: 0, home_errors: 0,
  line_score: [], state: { batIdx: { away: 0, home: 0 }, pitches: {} },
  lineups: { away: order(9), home: order(9) }, regulation_innings: 7, ...over,
});

// One tap: what the bug decides, given the row before and after and the stinger.
function tap(g, action) {
  const res = action(g);
  assert.ok(res && res.patch, 'the action produced a play');
  const next = { ...g, ...res.patch };
  const type = stinger(res, g, next);
  const d = decide(bugState(g), bugState(next), type ? { type, meta: res.animMeta || {} } : null);
  return { d, names: Array.from(d.moments, (m) => m[0]), next };  // Array.from: kit's arrays live in the vm
}

test('balls and strikes tick; a two-strike foul is nothing', () => {
  assert.deepEqual(tap(G(), L.onBall).names, ['ball']);
  assert.deepEqual(tap(G(), (g) => L.onStrike(g)).names, ['strike']);
  assert.deepEqual(tap(G({ strikes: 2 }), L.onFoul).names, []);
});

test('a walk animates as a walk (the pad sends it as "webgem")', () => {
  assert.deepEqual(tap(G({ balls: 3 }), walk).names, ['walk']);
  assert.deepEqual(tap(G({ balls: 3, bases: bases(1, 1, 1) }), walk).names, ['walk', 'run']);
});

test('hit by pitch, intentional walk and catcher\'s interference are walks', () => {
  assert.deepEqual(tap(G(), L.onHitByPitch).names, ['walk']);
  assert.deepEqual(tap(G(), L.onIntentionalWalk).names, ['walk']);
  assert.deepEqual(tap(G(), L.onCatcherInterference).names, ['walk']);
});

test('strikeouts, swinging and looking', () => {
  const sw = tap(G({ strikes: 2 }), (g) => L.onStrike(g));
  assert.deepEqual(sw.names, ['k']);
  assert.equal(sw.d.moments[0][1].looking, false);
  const lk = tap(G({ strikes: 2 }), (g) => L.onStrike(g, { looking: true }));
  assert.equal(lk.d.moments[0][1].looking, true);
});

test('a dropped third strike is still a strikeout', () => {
  assert.deepEqual(tap(G({ strikes: 2 }), inPlay('K3')).names, ['k']);
});

test('singles, doubles and triples say how far', () => {
  const one = tap(G({ bases: bases(0, 0, 1) }), inPlay('H1'));
  assert.deepEqual(one.names, ['hit', 'run']);
  assert.equal(one.d.moments[0][1].bases, 1);
  assert.equal(tap(G(), inPlay('H2')).d.moments[0][1].bases, 2);
  assert.equal(tap(G(), inPlay('H3')).d.moments[0][1].bases, 3);
});

test('reaching on an error is an error', () => {
  assert.deepEqual(tap(G(), inPlay('E')).names, ['error']);
});

test('outs in play, including a double play and a sac fly that scores', () => {
  assert.deepEqual(tap(G(), inPlay('GB')).names, ['out']);
  assert.deepEqual(tap(G(), inPlay('FB')).names, ['out']);
  assert.deepEqual(tap(G({ bases: bases(1, 0, 0) }), inPlay('DP')).names, ['out']);
  assert.deepEqual(tap(G({ bases: bases(0, 0, 1) }), inPlay('SF')).names, ['out', 'run']);
});

test('the third out holds on the old half before it rolls', () => {
  const gb = tap(G({ outs: 2 }), inPlay('GB'));
  assert.equal(gb.d.kind, 'roll');
  assert.deepEqual(gb.names, ['out']);
  const k = tap(G({ outs: 2, strikes: 2 }), (g) => L.onStrike(g));
  assert.equal(k.d.kind, 'roll');
  assert.deepEqual(k.names, ['k']);
});

test('runner plays: a steal is quiet, caught stealing is an out, a balk just scores', () => {
  assert.deepEqual(tap(G({ bases: bases(1, 0, 0) }), (g) => L.onRunnerPlay(g, 'first', 'SB')).names, []);
  assert.deepEqual(tap(G({ bases: bases(1, 0, 0) }), (g) => L.onRunnerPlay(g, 'first', 'CS')).names, ['out']);
  assert.deepEqual(tap(G({ bases: bases(0, 0, 1) }), L.onBalk).names, ['run']);
});

test('a home run holds its runs for the banner', () => {
  const solo = tap(G(), homer);
  assert.equal(solo.d.kind, 'hr');
  assert.equal(solo.d.moments[0][1].runs, 1);
  const slam = tap(G({ bases: bases(1, 1, 1) }), homer);
  assert.equal(slam.d.runs, 4);
});

test('a walk-off single ends with the walk-off', () => {
  const g = G({ inning: 7, half: 'bottom', away_score: 3, home_score: 3, bases: bases(0, 0, 1) });
  assert.deepEqual(tap(g, inPlay('H1')).names, ['hit', 'run', 'walkoff']);
});

test('an undo plays nothing, even across a half', () => {
  const rolled = tap(G({ outs: 2 }), inPlay('GB')).next;
  const back = decide(bugState(rolled), bugState(G({ outs: 2 })), null);
  assert.equal(back.moments.length, 0);
  const scored = tap(G({ bases: bases(0, 0, 1) }), inPlay('H1')).next;
  assert.equal(decide(bugState(scored), bugState(G({ bases: bases(0, 0, 1) })), null).moments.length, 0);
});

// ---- A real game, replayed -------------------------------------------------
// scripts/fixtures/game-events.json: a real 4-inning game, reduced to its
// event types and the row before each (no names). Each event's row turns into
// the next event's row; the stinger is fresh when its nonce changed.
test('a real game: every walk, strikeout, hit and out in play animates', () => {
  const { events } = JSON.parse(readFileSync(new URL('./fixtures/game-events.json', import.meta.url), 'utf8'));
  const row = (r) => bugState({ sport: 'baseball', ...r, show_pitchcount: false, state: {}, lineups: {} });
  const missed = [];
  const seen = { walk: 0, k: 0, hit: 0, out: 0 };
  for (let i = 0; i + 1 < events.length; i++) {
    const e = events[i], a = e.r, b = events[i + 1].r;
    if (e.u) continue;                                  // undone: the next row is the undo, not this play
    const fresh = b.anim && (!a.anim || a.anim.nonce !== b.anim.nonce) ? { type: b.anim.type, meta: { text: b.anim.text } } : null;
    const names = Array.from(decide(row(a), row(b), fresh).moments, (m) => m[0]);
    const want = e.t === 'walk' ? 'walk' : e.t === 'strikeout' ? 'k'
      : e.t === 'play' && /^H[123]$/.test(e.k) ? 'hit'
      : e.t === 'play' && /^(GB|FB|LD|PU|SF|SAC|FC|DP)$/.test(e.k) ? 'out' : null;
    if (!want) continue;
    seen[want]++;
    if (!names.includes(want)) missed.push(`#${i} ${e.t}${e.k ? ' ' + e.k : ''} → [${names}]`);
  }
  assert.deepEqual(missed, [], 'plays the bug did not animate');
  assert.ok(seen.walk >= 10 && seen.k >= 3 && seen.hit >= 3 && seen.out >= 5, `the fixture covers the plays: ${JSON.stringify(seen)}`);
});
