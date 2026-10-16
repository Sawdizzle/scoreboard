// The scoring check at End game: each slip a scorer can make, found and said
// plainly; a clean game says nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../lib/rules/logic.js';
import { auditGame } from '../lib/audit.ts';
import { engineGame, onPlay, pitcherChange, record, type G, type Res } from '../lib/scoring.ts';
import type { SummaryEvent, SummaryInput, SummaryStat } from '../lib/summarize.ts';
import type { Lineup } from '../lib/types.ts';

const team = (p: string, blank: number[] = []): Lineup => ({
  batters: Array.from({ length: 9 }, (_, i) => blank.includes(i) ? { bid: `${p}${i + 1}`, num: '', name: '' } : { bid: `${p}${i + 1}`, num: String(i + 1), name: `${p}${i + 1}` }),
  positions: { P: `${p}9`, C: `${p}2`, '1B': `${p}3`, '2B': `${p}4`, '3B': `${p}5`, SS: `${p}6`, LF: `${p}7`, CF: `${p}8`, RF: `${p}1` },
});
const sides = (e: 'home' | 'away') => (e === 'home' ? 'us' : 'them') as 'us' | 'them';
const walk = (g: G): Res => {
  const w = L.computeWalk(g.bases);
  return { type: 'walk', patch: L.endPA(g, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(g, w.runs) }), payload: { runs: w.runs, play: L.playNote(g, 'BB', { runs: w.runs }) } };
};
const homer = (g: G): Res => {
  const runs = L.computeHomeRun(g.bases).runs;
  return { type: 'homerun', patch: L.homeRunPatch(g, runs), payload: { runs, play: L.playNote(g, 'HR', { runs }) } };
};
const k = (g: G) => L.onStrike(g) as Res;
const ks = (n: number) => Array.from({ length: n * 3 }, () => k);
const single = (g: G) => L.onHit(g, 1) as Res;
void onPlay;

type Step = ((g: G) => Res | null) | { swap: (g: G) => void };
function game(steps: Step[], us = team('a'), them = team('h')): SummaryInput {
  let g = engineGame({ is_home: true, live: {}, status: 'live' }, { us, them }, 2);
  const events: SummaryEvent[] = [], stats: SummaryStat[] = [];
  for (const step of steps) {
    const res = typeof step === 'function' ? step(g) : (step.swap(g), pitcherChange(g));
    const r = record(g, res, sides);
    assert.ok(r, 'a tap that does nothing');
    const id = events.length + 1;
    const { lineups: _l, ...prev } = g; void _l;
    events.push({ id, seq: id, type: r.res.type, payload: r.res.payload ?? {}, prev_live: prev });
    for (const row of r.rows) stats.push({ event_id: id, ...row });
    g = r.next;
  }
  const { lineups: _n, status, ...live } = g; void _n;
  return { game: { is_home: true, status: String(status), live, sport: 'baseball' }, teams: { us: 'Blue Steel', them: 'Hawks' },
    events, stats, lineups: { us, them }, regulationInnings: 2 };
}
const codes = (i: SummaryInput) => auditGame({ ...i, ending: true }).map((x) => `${x.level}:${x.code}`);

// Two full innings, a few runs each way, nothing out of place.
const clean: Step[] = [homer, ...ks(3), walk, homer, ...ks(3), ...ks(3), single, ...ks(3)];

test('a clean game: nothing to check', () => {
  assert.deepEqual(auditGame({ ...game(clean), ending: true }), []);
});

test('an empty spot in our lineup: those at-bats count for nobody', () => {
  const i = game(clean, team('a', [0]));
  assert.deepEqual(codes(i), ['fix:no-batter', 'fix:lost-runner']);
  assert.match(auditGame({ ...i, ending: true })[0].text, /^1 time up for Blue Steel with an empty lineup spot\. Those at-bats count for nobody\.$/);
});

test('their empty lineup is not our problem; their filled one is checked lightly', () => {
  assert.deepEqual(codes(game(clean, team('a'), { batters: [], positions: {} })), []);
  assert.deepEqual(codes(game(clean, team('a'), team('h', [0]))), ['note:no-batter']);
});

test('no pitcher set for us: batters faced go on nobody’s line', () => {
  const us = { ...team('a'), positions: { ...team('a').positions, P: '' } };
  assert.ok(codes(game(clean, us)).includes('fix:no-pitcher'));
});

test('a run added with Run scored, or the score raised by hand, is flagged', () => {
  assert.ok(codes(game([...clean.slice(0, -3), (g) => L.onRun(g) as Res, ...ks(3)])).includes('fix:manual-run'));
  assert.ok(codes(game([...clean, (g) => L.adjustScore(g, 'home', 1) as Res])).includes('fix:adjusted'));
});

test('hits changed by hand, and the order moved by hand, are notes', () => {
  assert.deepEqual(codes(game([...clean, (g) => L.adjustHits(g, 'home', 1) as Res])), ['note:hits']);
  const moved = codes(game([homer, (g) => L.onNextBatter(g) as Res, ...ks(3), walk, homer, ...ks(3), ...ks(3), single, ...ks(3)]));
  assert.ok(moved.includes('note:order-moved'));
});

test('ending mid-inning, or short of regulation, is a note', () => {
  const i = game([homer, ...ks(3), walk, homer, k, k, k]);
  assert.deepEqual(codes(i), ['note:mid-inning', 'note:short']);
  assert.match(auditGame({ ...i, ending: true })[0].text, /1 out in the bottom of the 1st/);
});

test('v4 games: only missing runs, said plainly', () => {
  type V4 = { is_home: boolean; live: Record<string, unknown>; plays: [string, string, string, string, string][] };
  const fx = JSON.parse(readFileSync(new URL('./fixtures/v4-games.json', import.meta.url), 'utf8')) as Record<string, V4>;
  const v4 = (n: string): SummaryInput => ({
    game: { is_home: fx[n].is_home, status: 'final', live: fx[n].live, sport: 'baseball' }, teams: { us: 'Blue Steel', them: n },
    events: fx[n].plays.map(([inning, half, kind, code, runs], i) => ({ id: i + 1, seq: i + 1, type: kind, prev_live: {}, payload: { source: 'v4', play: { inning: Number(inning), half, kind, code, runs: Number(runs) } } })),
  });
  assert.deepEqual(auditGame(v4('desp')), []);
  const krum = auditGame(v4('krum'));
  assert.deepEqual(krum.map((x) => x.code), ['gap']);
  assert.equal(krum[0].text, "Bottom of the 1st: 2 runs for Blue Steel with no play that scored them. Recaps give the inning's total but not how.");
});

test('no lineup for us at all: one note, not a fix per at-bat', () => {
  const none = { batters: [], positions: {} };
  assert.deepEqual(codes(game(clean, none, none)), ['note:no-lineup']);
});
