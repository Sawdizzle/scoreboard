// Plays run through Scoreboard's rules and lib/scoring together: what each
// one puts on the batter's, pitcher's and runners' lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../lib/rules/logic.js';
import { batterBid, engineGame, gameOver, onPlay, orderChange, record, type G, type Res, type StatRow } from '../lib/scoring.ts';
import type { Lineup } from '../lib/types.ts';

// Us at home. Our order a1..a9 with a9 pitching; theirs h1..h9 with h9 pitching.
const team = (p: string): Lineup => ({
  batters: Array.from({ length: 9 }, (_, i) => ({ bid: `${p}${i + 1}`, num: String(i + 1), name: `${p}${i + 1}` })),
  positions: { P: `${p}9`, C: `${p}2`, '1B': `${p}3`, '2B': `${p}4`, '3B': `${p}5`, SS: `${p}6`, LF: `${p}7`, CF: `${p}8`, RF: `${p}1` },
});
const sides = (e: 'home' | 'away') => (e === 'home' ? 'us' : 'them') as 'us' | 'them';
const start = (): G => engineGame({ is_home: true, live: {}, status: 'scheduled' }, { us: team('a'), them: team('h') });

// Tap through a list of actions, collecting every stat row.
function run(g: G, ...taps: ((g: G) => Res | null)[]) {
  const rows: StatRow[] = [];
  for (const tap of taps) {
    const r = record(g, tap(g), sides);
    assert.ok(r, 'a tap that does nothing');
    rows.push(...r.rows);
    g = r.next;
  }
  return { g, rows };
}
// Sum a player's rows into one line.
const line = (rows: StatRow[], bid: string) => rows.filter((r) => r.bid === bid).reduce((a, r) => {
  for (const [k, v] of Object.entries(r)) if (typeof v === 'number') a[k] = (a[k] ?? 0) + v;
  return a;
}, {} as Record<string, number>);

const play = (kind: string, pos: string | null = null, dest?: Record<string, number | 'out'>) =>
  (g: G) => onPlay(g, { kind, pos, dest: dest ?? (L.playDefaults(g, kind) as unknown as Record<string, number | 'out'>) });
const walk = (g: G) => {
  const w = L.computeWalk(g.bases);
  return { type: 'walk', patch: L.endPA(g, { balls: 0, strikes: 0, bases: w.bases, ...L.runsPatch(g, w.runs) }), payload: { runs: w.runs, play: L.playNote(g, 'BB', { runs: w.runs }) } };
};
const homer = (g: G) => {
  const runs = L.computeHomeRun(g.bases).runs;
  return { type: 'homerun', patch: L.homeRunPatch(g, runs), payload: { runs, play: L.playNote(g, 'HR', { runs }) } };
};

test('pitches count for the pitcher on the mound, and nobody else', () => {
  const { rows } = run(start(), L.onBall, L.onStrike, L.onFoul);
  // Top of the 1st: they bat, our a9 pitches.
  assert.deepEqual(line(rows, 'a9'), { p_pitches: 3 });
  assert.deepEqual(line(rows, 'h1'), {});
});

test('a strikeout: PA, AB and K for the batter, an out and a K for the pitcher', () => {
  const { rows } = run(start(), L.onStrike, L.onStrike, (g) => L.onStrike(g, { looking: true }));
  assert.deepEqual(line(rows, 'h1'), { b_pa: 1, b_ab: 1, b_so: 1, b_kl: 1 });
  assert.deepEqual(line(rows, 'a9'), { p_pitches: 3, p_bf: 1, p_outs: 1, p_so: 1 });
});

test('a walk is a PA without an at-bat; the batter becomes the runner on first', () => {
  const { g, rows } = run(start(), walk);
  assert.deepEqual(line(rows, 'h1'), { b_pa: 1, b_bb: 1 });
  assert.deepEqual(line(rows, 'a9'), { p_pitches: 1, p_bf: 1, p_bb: 1 });
  assert.deepEqual((g.state as { runners: unknown }).runners, { first: 'h1', second: null, third: null });
});

test('a double scores the runner from first; the RBI is the hitter\'s, the run is the runner\'s', () => {
  const { rows } = run(start(), walk, play('H2', 'LF', { batter: 2, first: 4 }));
  assert.deepEqual(line(rows, 'h2'), { b_pa: 1, b_ab: 1, b_h: 1, b_2b: 1, b_rbi: 1 });
  assert.equal(line(rows, 'h1').b_r, 1);
  assert.equal(line(rows, 'a9').p_r, 1);
  assert.equal(line(rows, 'a9').p_h, 1);
});

test('a home run with two on: three RBI, a run each for all three', () => {
  const { rows } = run(start(), walk, walk, homer);
  assert.deepEqual(line(rows, 'h3'), { b_pa: 1, b_ab: 1, b_h: 1, b_hr: 1, b_rbi: 3, b_r: 1 });
  assert.equal(line(rows, 'h1').b_r, 1);
  assert.equal(line(rows, 'h2').b_r, 1);
  assert.equal(line(rows, 'a9').p_r, 3);
});

test('no RBI on an error or a double play', () => {
  const { rows } = run(start(), walk, walk, walk, play('E', 'SS', { batter: 1, first: 2, second: 3, third: 4 }));
  assert.deepEqual(line(rows, 'h4'), { b_pa: 1, b_ab: 1, b_roe: 1 });
  assert.equal(line(rows, 'h1').b_r, 1);
  const dp = run(start(), walk, play('DP', 'SS'));
  assert.deepEqual(line(dp.rows, 'h2'), { b_pa: 1, b_ab: 1 });
  assert.equal(line(dp.rows, 'a9').p_outs, 2);
});

test('a sac fly is a PA and an RBI but no at-bat', () => {
  const { rows } = run(start(), walk, (g) => L.onRunnerPlay(g, 'first', 'SB'), (g) => L.onRunnerPlay(g, 'second', 'SB'), play('SF', 'CF'));
  assert.deepEqual(line(rows, 'h2'), { b_pa: 1, b_sf: 1, b_rbi: 1 });
  assert.deepEqual(line(rows, 'h1'), { b_pa: 1, b_bb: 1, b_sb: 2, b_r: 1 });
});

test('caught stealing goes on the runner and the out on the pitcher; the batter stays up', () => {
  const { g, rows } = run(start(), walk, (g) => L.onRunnerPlay(g, 'first', 'CS'));
  assert.equal(line(rows, 'h1').b_cs, 1);
  assert.equal(line(rows, 'a9').p_outs, 1);
  assert.equal(L.currentBatterIdx(g, 'away'), 1);
});

test('the third out ends the half: runners clear, and the next half\'s pitches go to their pitcher', () => {
  let { g } = run(start(), walk, L.onOut, L.onOut);
  assert.deepEqual((g.state as { runners: unknown }).runners, { first: 'h1', second: null, third: null });
  ({ g } = run(g, L.onOut));
  assert.equal(g.half, 'bottom');
  assert.deepEqual((g.state as { runners: unknown }).runners, { first: null, second: null, third: null });
  const { rows } = run(g, L.onBall);
  assert.deepEqual(line(rows, 'h9'), { p_pitches: 1 });
});

test('runs that do not count on a third-out force are not credited', () => {
  // Bases loaded, two out, groundout: the inning ends, nobody scores.
  let { g } = run(start(), walk, walk, walk, L.onOut, L.onOut);
  const r = run(g, play('GB', 'SS'));
  assert.equal(r.g.away_score, 0);
  assert.equal(r.rows.some((x) => x.b_r), false);
  assert.equal(line(r.rows, 'h6').b_rbi ?? 0, 0);
  g = r.g;
});

test('a correction moves the game and adds nothing to anyone', () => {
  const r = record(start(), L.adjustScore(start(), 'away', 1), sides)!;
  assert.deepEqual(r.rows, []);
  assert.equal(r.next.away_score, 1);
});

test('a runner the rules no longer have on base is forgotten', () => {
  let { g } = run(start(), walk);
  const r = record(g, L.toggleBase(g, 'first'), sides)!;
  g = r.next;
  assert.deepEqual((g.state as { runners: unknown }).runners, { first: null, second: null, third: null });
});

test('our side and theirs: our batters are "us" at home, the visitors are "them"', () => {
  let { g } = run(start(), L.onOut, L.onOut, L.onOut);
  const { rows } = run(g, walk);
  assert.deepEqual(rows.find((x) => x.bid === 'a1')?.side, 'us');
  assert.deepEqual(rows.find((x) => x.bid === 'h9')?.side, 'them');
  g = start();
});

test('earned runs: a batter who reached on an error never scores an earned run', () => {
  // Error puts h1 on; h2 homers. Two runs, one earned.
  const { rows } = run(start(), play('E', 'SS', { batter: 1 }), homer);
  assert.equal(line(rows, 'a9').p_r, 2);
  assert.equal(line(rows, 'a9').p_er, 1);
});

test('earned runs: every run on the error play itself is unearned', () => {
  const { rows } = run(start(), walk, walk, walk, play('E', 'SS', { batter: 1, first: 2, second: 3, third: 4 }));
  assert.equal(line(rows, 'a9').p_r, 1);
  assert.equal(line(rows, 'a9').p_er ?? 0, 0);
});

test('earned runs: after an error that should have been the third out, nothing is earned', () => {
  // Two out, error extends the half, then a clean home run with a clean runner on.
  const { rows, g } = run(start(), L.onOut, L.onOut, play('E', '3B', { batter: 1 }), walk, homer);
  assert.equal(line(rows, 'a9').p_r, 3);
  assert.equal(line(rows, 'a9').p_er ?? 0, 0);
  // The next half starts clean.
  const after = run(g, L.onOut);
  assert.equal(after.g.half, 'bottom');
  assert.equal((after.g.state as { errOuts: number }).errOuts, 0);
  assert.equal(line(run(after.g, homer).rows, 'h9').p_er, 1);
});

test('earned runs: with no error in the half, every run is earned', () => {
  const { rows } = run(start(), walk, walk, homer);
  assert.equal(line(rows, 'a9').p_er, 3);
});

// A lineup edited on the lineup screen between plays, the way the pad then
// sees it: the same game state with a new lineup for one side.
const withLineup = (g: G, side: 'home' | 'away', l: Lineup): G => ({ ...g, lineups: { ...g.lineups, [side]: l } });
const apply = (g: G, res: Res | null) => { const r = record(g, res, sides); assert.ok(r); return r.next; };

test('a player dropped above the batter who is up: the same batter stays up', () => {
  // Top 1st: they (away, h) bat. Two outs, so h3 is up.
  let g = run(start(), L.onOut, L.onOut).g;
  assert.equal(batterBid(g), 'h3');
  const them = team('h');
  g = withLineup(g, 'away', { ...them, batters: them.batters.filter((b) => b.bid !== 'h1') });
  // Without the fix, slot 2 is now h4: h3 would be skipped.
  assert.equal(batterBid(g), 'h4');
  g = apply(g, orderChange(g));
  assert.equal(batterBid(g), 'h3');
  assert.equal(orderChange(g), null);
});

test('the order reshuffled mid-game: the batter who was up is still up', () => {
  let g = run(start(), L.onOut).g;
  assert.equal(batterBid(g), 'h2');
  const them = team('h');
  g = withLineup(g, 'away', { ...them, batters: [...them.batters].reverse() });
  g = apply(g, orderChange(g));
  assert.equal(batterBid(g), 'h2');
});

test('the batter who was up is subbed out in his spot: his sub is up', () => {
  let g = run(start(), L.onOut).g;
  const them = team('h');
  const sub = { bid: 'x1', num: '44', name: 'Sub' };
  g = withLineup(g, 'away', { ...them, batters: them.batters.map((b) => (b.bid === 'h2' ? sub : b)) });
  assert.equal(orderChange(g), null);
  assert.equal(batterBid(g), 'x1');
});

test('the order got shorter than the slot that was up: it wraps to the top', () => {
  // The order pointed at the ninth slot: h9 up for them.
  let g = start();
  g = { ...g, state: { ...g.state, batIdx: { away: 8 } } };
  g = apply(g, L.onBall(g));
  assert.equal(batterBid(g), 'h9');
  const them = team('h');
  g = withLineup(g, 'away', { ...them, batters: them.batters.slice(0, 8) });
  assert.equal(batterBid(g), null);
  g = apply(g, orderChange(g));
  assert.equal(batterBid(g), 'h1');
});

test('the fielding side is kept too: their leadoff man next inning stays the same', () => {
  // Top 1st, we (home, a) field; a1 leads off our half.
  let g = run(start(), L.onBall).g;
  const us = team('a');
  g = withLineup(g, 'home', { ...us, batters: [us.batters[8], ...us.batters.slice(0, 8)] });
  g = apply(g, orderChange(g));
  assert.equal(g.lineups.home.batters[L.currentBatterIdx(g, 'home')].bid, 'a1');
});

test('nothing to correct before the first play, or with no lineup change', () => {
  assert.equal(orderChange(start()), null);
  assert.equal(orderChange(run(start(), L.onBall).g), null);
});

// ---- Game over? ----------------------------------------------------------------
test('game over: home ahead in the bottom of the last, a full extra inning, the run rule', () => {
  const at = (live: Record<string, unknown>) => ({ ...engineGame({ is_home: true, live, status: 'live' }, {}, 7) }) as G;
  // Top of the 7th just ended with home ahead.
  assert.equal(gameOver(at({ inning: 7, half: 'bottom', home_score: 5, away_score: 3 }))?.why, 'last');
  // Bottom of the 7th, away ahead: play on.
  assert.equal(gameOver(at({ inning: 7, half: 'bottom', home_score: 2, away_score: 3 })), null);
  // A tie after seven: the scorer's call.
  assert.equal(gameOver(at({ inning: 8, half: 'top', home_score: 3, away_score: 3 })), null);
  // The 8th ended with the away team ahead.
  assert.deepEqual(gameOver(at({ inning: 9, half: 'top', home_score: 3, away_score: 4 }))?.leader, 'away');
  // Run rule 10: home up 12 in the bottom of the 4th is over at once.
  assert.equal(gameOver(at({ inning: 4, half: 'bottom', outs: 2, home_score: 12, away_score: 0 }), 10)?.why, 'runrule');
  // Not in the 2nd: too early.
  assert.equal(gameOver(at({ inning: 2, half: 'bottom', home_score: 12, away_score: 0 }), 10), null);
  // Away up 10 after the top of the 5th: home still bats.
  assert.equal(gameOver(at({ inning: 5, half: 'bottom', home_score: 0, away_score: 10 }), 10), null);
  // ... and after the bottom it is over.
  assert.equal(gameOver(at({ inning: 6, half: 'top', home_score: 0, away_score: 10 }), 10)?.leader, 'away');
  // No run rule set: no run-rule ending.
  assert.equal(gameOver(at({ inning: 4, half: 'bottom', home_score: 12, away_score: 0 })), null);
});
