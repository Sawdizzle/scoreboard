// summarizeGame: a game's play log turned into the facts a recap may use.
// A pad game is played through the real rules and lib/scoring, stored the way
// the pad stores it (each event with the game before it, stat rows by event),
// then summarized. Two v4 games come from the live database as they were
// imported (tests/fixtures/v4-games.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../lib/rules/logic.js';
import { engineGame, onPlay, pitcherChange, record, type G, type Res } from '../lib/scoring.ts';
import { summarizeGame, type SummaryEvent, type SummaryInput, type SummaryStat } from '../lib/summarize.ts';
import type { Lineup } from '../lib/types.ts';

const team = (p: string): Lineup => ({
  batters: Array.from({ length: 9 }, (_, i) => ({ bid: `${p}${i + 1}`, num: String(i + 1), name: `${p}${i + 1}` })),
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
const dp = (g: G) => onPlay(g, { kind: 'DP', pos: 'SS', dest: L.playDefaults(g, 'DP') as unknown as Record<string, number | 'out'> });
const endGame = (): Res => ({ type: 'end_game', patch: { status: 'final' } });

// A pad game: us at home, they bat first. Each tap is stored as the pad
// stores it; a function in the list may change the lineups first.
type Step = ((g: G) => Res | null) | { swap: (g: G) => void };
function padGame(steps: Step[]) {
  let g = engineGame({ is_home: true, live: {}, status: 'live' }, { us: team('a'), them: team('h') }, 2);
  const events: SummaryEvent[] = [], stats: SummaryStat[] = [];
  for (const step of steps) {
    let res: Res | null;
    if (typeof step === 'function') res = step(g);
    else { step.swap(g); res = pitcherChange(g); }
    const r = record(g, res, sides);
    assert.ok(r, 'a tap that does nothing');
    const id = events.length + 1;
    const { lineups: _l, ...prev } = g;
    void _l;
    events.push({ id, seq: id, type: r.res.type, payload: r.res.payload ?? {}, prev_live: prev });
    for (const row of r.rows) stats.push({ event_id: id, ...row });
    g = r.next;
  }
  const { lineups, status, ...live } = g;
  return { events, stats, live, status: String(status), lineups };
}

const ks = (n: number) => Array.from({ length: n * 3 }, () => k);

// They homer in the 1st; we take the lead on a two-run homer after a double
// play; they hit a grand slam in the 2nd; we tie it and walk it off.
const steps: Step[] = [
  homer, ...ks(3),                                  // top 1st: h1 solo HR, 1-0 them
  walk, walk, dp, homer, ...ks(1),                  // bot 1st: a1, a2 walk; a3 DP; a4 2-run HR; 2-1 us
  walk, walk, walk, homer, ...ks(3),                // top 2nd: h5-h7 walk, h8 grand slam; 5-2 them
  { swap: (g) => { g.lineups.away.positions.P = 'h3'; } },
  walk, walk, homer, homer, endGame,                // bot 2nd: a6, a7 walk; a8 3-run HR (5-5); a9 walks it off
];

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  const p = padGame(steps);
  return {
    game: { is_home: true, status: p.status, live: p.live, sport: 'baseball' },
    teams: { us: 'Blue Steel', them: 'Krum' }, events: p.events, stats: p.stats,
    lineups: { us: team('a'), them: team('h') }, regulationInnings: 2, ...over,
  };
}

test('a pad game: line score, result and every run from the log', () => {
  const f = summarizeGame(input());
  assert.equal(f.source, 'pad');
  assert.equal(f.final, true);
  assert.deepEqual(f.score, { us: 6, them: 5 });
  assert.equal(f.result, 'W');
  assert.deepEqual(f.lineScore.innings.map((r) => [r.them, r.us]), [[1, 2], [4, 4]]);
  assert.equal(f.runsMatchScore, true);
  assert.deepEqual(f.gaps, []);
  assert.deepEqual(f.scoringPlays.map((s) => [s.inning, s.half, s.side, s.runs, s.batter, `${s.score.us}-${s.score.them}`]), [
    [1, 'top', 'them', 1, 'h1', '0-1'],
    [1, 'bottom', 'us', 2, 'a4', '2-1'],
    [2, 'top', 'them', 4, 'h8', '2-5'],
    [2, 'bottom', 'us', 3, 'a8', '5-5'],
    [2, 'bottom', 'us', 1, 'a9', '6-5'],
  ]);
  assert.ok(f.scoringPlays.every((s) => s.what === 'Home run'));
  // Who crossed the plate on the 2-run homer: the runner left by the double play, and the hitter.
  assert.equal(f.scoringPlays[1].scorers.length, 2);
  assert.ok(f.scoringPlays[1].scorers.includes('a4'));
});

test('lead changes, ties and the deficit overcome', () => {
  const f = summarizeGame(input());
  assert.deepEqual(f.leadChanges.map((c) => [c.inning, c.half, c.side]), [[1, 'bottom', 'us'], [2, 'top', 'them'], [2, 'bottom', 'us']]);
  assert.equal(f.ties, 1);
  assert.deepEqual(f.biggestDeficit, { us: 3, them: 1 });
});

test('moments: homers, the grand slam, the double play, the walk-off and the comeback', () => {
  const f = summarizeGame(input());
  const kinds = f.moments.map((m) => m.kind);
  assert.equal(kinds.filter((x) => x === 'HR').length, 4);
  assert.ok(kinds.includes('GS'));
  assert.ok(kinds.includes('DP'));
  assert.ok(kinds.includes('walkoff'));
  assert.ok(kinds.includes('comeback'));
  assert.ok(!kinds.includes('run_rule'));
  const gs = f.moments.find((m) => m.kind === 'GS')!;
  assert.equal(gs.text, 'h8 hit a grand slam');
  // The double play is a moment for the side that turned it.
  assert.equal(f.moments.find((m) => m.kind === 'DP')!.side, 'them');
  assert.match(f.moments.find((m) => m.kind === 'walkoff')!.text, /Home run/);
});

test('strikeouts by each side’s pitchers, and the pitching change', () => {
  const f = summarizeGame(input());
  assert.deepEqual(f.strikeouts, { us: 6, them: 1 });
  assert.deepEqual(f.pitchingChanges.map((p) => [p.inning, p.half, p.side, p.pitcher]), [[2, 'bottom', 'them', 'h3']]);
});

test('standouts come from the stat rows, ours first', () => {
  const f = summarizeGame(input());
  assert.ok(f.standouts.length > 0);
  assert.equal(f.standouts[0].side, 'us');
  const a8 = f.standouts.find((s) => s.name === 'a8');
  assert.ok(a8);
  assert.equal(a8.line, '1-1, HR, 3 RBI, R');
});

test('an undone play is not in the facts: undo deletes it and puts the game back', () => {
  const full = input();
  // Undo the end of the game and the walk-off homer, as undo_play does twice.
  const events = full.events.slice(0, -2);
  const live = full.events.at(-2)!.prev_live!;
  const stats = full.stats!.filter((s) => s.event_id <= events.length);
  const f = summarizeGame({ ...full, game: { ...full.game, status: 'live', live }, events, stats });
  assert.deepEqual(f.score, { us: 5, them: 5 });
  assert.equal(f.final, false);
  assert.equal(f.result, null);
  assert.equal(f.runsMatchScore, true);
  assert.ok(!f.scoringPlays.some((s) => s.batter === 'a9'));
  assert.ok(!f.moments.some((m) => m.kind === 'walkoff'));
});

test('names follow the lineups passed in: number only, or left out', () => {
  const hidden = (l: Lineup): Lineup => ({ ...l, batters: l.batters.map((b) => ({ ...b, name: '' })) });
  const f = summarizeGame(input({ lineups: { us: hidden(team('a')), them: { batters: [], positions: {} } } }));
  assert.equal(f.scoringPlays[1].batter, '#4');
  assert.equal(f.scoringPlays[0].batter, null);
  assert.equal(f.moments.find((m) => m.kind === 'GS')!.text, 'A batter hit a grand slam');
  assert.ok(f.standouts.every((s) => s.side === 'us' && s.name.startsWith('#')));
});

test('a score corrected on the Situation screen is marked as a correction', () => {
  const base = input();
  // Bump our score by one after the last play, as Adjust score would.
  let g = { ...base.game.live, lineups: { home: team('a'), away: team('h') } } as unknown as G;
  const r = record(g, L.adjustScore(g, 'home', 1) as Res, sides)!;
  const { lineups: _l, ...prev } = g;
  void _l;
  g = r.next;
  const { lineups: _n, ...live } = g;
  void _n;
  const id = base.events.length + 1;
  const f = summarizeGame({ ...base, game: { ...base.game, live }, events: [...base.events, { id, seq: id, type: r.res.type, payload: r.res.payload ?? {}, prev_live: prev }] });
  const last = f.scoringPlays.at(-1)!;
  assert.equal(last.correction, true);
  assert.equal(last.what, 'Score corrected');
  assert.deepEqual(f.score, { us: 7, them: 5 });
});

test('the run rule, as the Final card judges it', () => {
  const p = padGame([walk, walk, walk, homer, homer, ...ks(3), endGame]);
  // They lead 5-0 after one half; with a 5-run rule over 4 innings the game is over.
  const f = summarizeGame({
    game: { is_home: true, status: 'final', live: { ...p.live, status: 'final' }, sport: 'baseball' }, teams: { us: 'Blue Steel', them: 'Krum' },
    events: p.events, stats: p.stats, lineups: { us: team('a'), them: team('h') }, regulationInnings: 4, runRule: 5,
  });
  assert.equal(f.result, 'L');
  assert.ok(f.moments.some((m) => m.kind === 'run_rule' && m.side === 'them'));
  assert.ok(f.moments.some((m) => m.kind === 'shutout' && m.side === 'them'));
  assert.ok(f.moments.some((m) => m.kind === 'big_inning' && m.side === 'them'));
});

// ---- v4 games, as imported ---------------------------------------------------
type V4 = { is_home: boolean; live: Record<string, unknown>; plays: [string, string, string, string, string][] };
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/v4-games.json', import.meta.url), 'utf8')) as Record<string, V4>;
const v4 = (name: string): SummaryInput => {
  const g = fixtures[name];
  return {
    game: { is_home: g.is_home, status: 'final', live: g.live, sport: 'baseball' },
    teams: { us: 'Blue Steel', them: name.toUpperCase() },
    events: g.plays.map(([inning, half, kind, code, runs], i) => ({
      id: i + 1, seq: i + 1, type: kind, prev_live: {},
      payload: { source: 'v4', play: { inning: Number(inning), half, kind, code, runs: Number(runs), outs: 0, pos: null } },
    })),
  };
};

test('a v4 game whose log adds up: every run, in order, with no names', () => {
  const f = summarizeGame(v4('desp'));
  assert.equal(f.source, 'v4');
  assert.equal(f.result, 'L');
  assert.deepEqual(f.score, { us: 2, them: 9 });
  assert.equal(f.runsMatchScore, true);
  assert.deepEqual(f.scoringPlays.map((s) => [s.inning, s.side, s.runs, s.what]), [
    [1, 'us', 1, 'Groundout 6-3'], [1, 'us', 1, 'Walk'], [1, 'them', 1, 'Single'],
    [2, 'them', 1, 'Single'], [2, 'them', 1, 'Groundout 1-3'], [2, 'them', 2, 'Double'], [2, 'them', 2, 'Double'], [2, 'them', 2, 'Single'],
  ]);
  assert.ok(f.scoringPlays.every((s) => s.batter === null));
  assert.equal(f.leadChanges.length, 1);
  assert.equal(f.ties, 1);
  assert.deepEqual(f.strikeouts, { us: 2, them: 2 });
  assert.ok(f.moments.some((m) => m.kind === 'big_inning' && m.side === 'them' && m.text === '8-run 2nd'));
  assert.deepEqual(f.standouts, []);
});

test('a v4 game with runs missing from its log says where', () => {
  const f = summarizeGame(v4('krum'));
  assert.equal(f.result, 'W');
  assert.deepEqual(f.score, { us: 10, them: 2 });
  assert.equal(f.runsMatchScore, false);
  assert.deepEqual(f.gaps, [{ inning: 1, half: 'bottom', side: 'us', runs: 2 }]);
  assert.deepEqual(f.lineScore.us, { r: 10, h: 4, e: 3 });
});

test('the other sports: the score, and no plays', () => {
  const f = summarizeGame({ game: { is_home: false, status: 'final', live: { home_score: 21, away_score: 14 }, sport: 'football' }, teams: { us: 'Us', them: 'Them' }, events: [] });
  assert.equal(f.result, 'L');
  assert.deepEqual(f.scoringPlays, []);
  assert.equal(f.source, 'none');
});
