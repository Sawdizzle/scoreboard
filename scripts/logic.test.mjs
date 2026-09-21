// Baseball rules — js/logic.js.
//
// This is the code where a wrong answer shows up live on a stream, and it is
// pure: a game row in, a patch out, no DOM and no network. check.mjs catches a
// control that has stopped being wired to anything; nothing caught wrong
// baseball until these.
//
// Run: node --test scripts/logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModule } from './load-module.mjs';

const L = await loadModule('js/logic.js');

// A game row with just the fields the rules touch. `over` overrides.
const bases = (f, s, t) => ({ first: !!f, second: !!s, third: !!t });
const G = (over = {}) => ({
  id: 'g1', sport: 'baseball', half: 'top', inning: 1,
  balls: 0, strikes: 0, outs: 0, bases: bases(0, 0, 0),
  away_score: 0, home_score: 0, away_hits: 0, home_hits: 0, away_errors: 0, home_errors: 0,
  line_score: [], state: {}, lineups: {}, regulation_innings: 0, ...over,
});
// A batting order; `filled` marks which of the nine slots have a name.
const order = (filled) => ({ batters: filled.map((on, i) => (on ? { num: String(i + 1), name: 'B' + i } : { num: '', name: '' })) });

// ---------------------------------------------------------------------------
// Counting the pitch, and whose pitcher threw it
// ---------------------------------------------------------------------------
test('a ball counts the pitch against the fielding team', () => {
  const r = L.onBall(G());                       // top half: home is in the field
  assert.equal(r.type, 'ball');
  assert.equal(r.patch.balls, 1);
  assert.deepEqual(r.patch.state.pitches, { home: 1 });
});

test('in the bottom half the pitch counts against the away pitcher', () => {
  const r = L.onBall(G({ half: 'bottom' }));
  assert.deepEqual(r.patch.state.pitches, { away: 1 });
});

test('the fourth ball is a walk, and asks before it commits', () => {
  const r = L.onBall(G({ balls: 3, bases: bases(1, 1, 1) }));
  assert.equal(r.type, 'walk');
  assert.equal(r.sheet, 'walk', 'the confirm sheet rebuilds the patch, so this one carries no pitch');
  assert.equal(r.payload.runs, 1, 'bases loaded forces one in');
  assert.equal(r.patch.balls, 0);
  assert.equal(r.patch.away_score, 1);
});

test('a foul with two strikes is a pitch and nothing else', () => {
  const r = L.onFoul(G({ strikes: 2 }));
  assert.equal(r.patch.strikes, undefined, 'the count cannot go past two on a foul');
  assert.deepEqual(r.patch.state.pitches, { home: 1 });
});

test('a foul under two strikes advances the count', () => {
  assert.equal(L.onFoul(G({ strikes: 1 })).patch.strikes, 2);
});

// ---------------------------------------------------------------------------
// Outs, and the half-inning rolling over
// ---------------------------------------------------------------------------
test('a third strike is a strikeout, and clears the count', () => {
  const r = L.onStrike(G({ strikes: 2 }));
  assert.equal(r.type, 'strikeout');
  assert.equal(r.patch.outs, 1);
  assert.equal(r.patch.strikes, 0);
  assert.deepEqual(r.patch.state.pitches, { home: 1 }, 'the third strike is still a pitch');
});

test('the third out rolls the half-inning', () => {
  const r = L.onOut(G({ outs: 2, balls: 2, strikes: 1, bases: bases(1, 0, 1) }));
  assert.equal(r.payload.rolled, true);
  assert.equal(r.patch.half, 'bottom');
  assert.equal(r.patch.inning, 1, 'top to bottom stays in the same inning');
  assert.deepEqual(r.patch, { ...r.patch, outs: 0, balls: 0, strikes: 0, bases: bases(0, 0, 0) });
});

test('the third out in the bottom half starts the next inning', () => {
  const r = L.onOut(G({ half: 'bottom', outs: 2, inning: 4 }));
  assert.equal(r.patch.half, 'top');
  assert.equal(r.patch.inning, 5);
});

test('rolling the half extends the line score to cover the new inning', () => {
  const r = L.onEndHalf(G({ half: 'bottom', inning: 2, line_score: [{ top: 1, bottom: 0 }, { top: 0, bottom: 2 }] }));
  assert.equal(r.patch.line_score.length, 3);
  assert.deepEqual(r.patch.line_score[2], { top: 0, bottom: 0 });
});

// ---------------------------------------------------------------------------
// Runs, and the line score cell they land in
// ---------------------------------------------------------------------------
test('a run goes to the batting team and this half\'s cell', () => {
  const r = L.onRun(G({ inning: 3, line_score: [{ top: 1, bottom: 0 }, { top: 0, bottom: 0 }, { top: 0, bottom: 0 }] }));
  assert.equal(r.patch.away_score, 1);
  assert.equal(r.patch.line_score[2].top, 1);
  assert.equal(r.patch.line_score[0].top, 1, 'earlier innings are left alone');
});

test('in the bottom half the run lands in the bottom cell', () => {
  const r = L.onRun(G({ half: 'bottom', inning: 2, home_score: 3 }));
  assert.equal(r.patch.home_score, 4);
  assert.equal(r.patch.line_score[1].bottom, 1);
  assert.equal(r.patch.line_score.length, 2, 'the line score is padded out to the current inning');
});

test('advancing everyone scores the runner on third', () => {
  const r = L.onAdvance(G({ bases: bases(1, 1, 1) }));
  assert.deepEqual(r.patch.bases, bases(0, 1, 1));
  assert.equal(r.payload.runs, 1);
  assert.equal(r.patch.away_score, 1);
});

test('advancing with nobody on third scores nobody', () => {
  const r = L.onAdvance(G({ bases: bases(1, 0, 0) }));
  assert.deepEqual(r.patch.bases, bases(0, 1, 0));
  assert.equal(r.payload.runs, 0);
  assert.equal(r.patch.away_score, undefined);
});

// ---------------------------------------------------------------------------
// Hits: every runner advances as far as the batter did
// ---------------------------------------------------------------------------
test('a single moves a runner from second to third', () => {
  const r = L.onHit(G({ bases: bases(0, 1, 0) }), 1);
  assert.deepEqual(r.patch.bases, bases(1, 0, 1));
  assert.equal(r.payload.runs, 0);
  assert.equal(r.patch.away_hits, 1);
});

test('a single scores the runner from third', () => {
  const r = L.onHit(G({ bases: bases(0, 0, 1) }), 1);
  assert.deepEqual(r.patch.bases, bases(1, 0, 0));
  assert.equal(r.payload.runs, 1);
  assert.equal(r.patch.away_score, 1);
});

test('a double puts the batter on second and the runner from first on third', () => {
  const r = L.onHit(G({ bases: bases(1, 0, 0) }), 2);
  assert.deepEqual(r.patch.bases, bases(0, 1, 1));
  assert.equal(r.payload.runs, 0);
});

test('a triple with the bases loaded clears them and scores three', () => {
  const r = L.onHit(G({ bases: bases(1, 1, 1) }), 3);
  assert.deepEqual(r.patch.bases, bases(0, 0, 1), 'only the batter is left, on third');
  assert.equal(r.payload.runs, 3);
  assert.equal(r.patch.away_score, 3);
  assert.equal(r.anim, 'bigplay', 'a triple earns a stinger');
});

test('a hit is credited to the batting team, not the fielding one', () => {
  assert.equal(L.onHit(G({ half: 'bottom' }), 1).patch.home_hits, 1);
});

test('an error is charged to the team in the field', () => {
  assert.equal(L.onError(G()).patch.home_errors, 1, 'top half: home is fielding');
  assert.equal(L.onError(G({ half: 'bottom' })).patch.away_errors, 1);
});

test('an error does not end the at-bat or count a pitch', () => {
  const r = L.onError(G());
  assert.equal(r.patch.state, undefined);
  assert.equal(r.patch.balls, undefined);
});

test('a home run clears the bases and scores everyone', () => {
  const r = L.homeRunPatch(G({ bases: bases(1, 0, 1) }), 3);
  assert.deepEqual(r.bases, bases(0, 0, 0));
  assert.equal(r.away_score, 3);
  assert.equal(r.away_hits, 1);
  assert.equal(r.balls, 0);
  assert.equal(r.strikes, 0);
});

// ---------------------------------------------------------------------------
// The batting order — one tap has to move everything
// ---------------------------------------------------------------------------
test('a terminal play advances the order and counts the pitch', () => {
  const g = G({ lineups: { away: order([1, 1, 1]) }, state: { batIdx: { away: 0 } } });
  const r = L.onHit(g, 1);
  assert.equal(r.patch.state.batIdx.away, 1);
  assert.deepEqual(r.patch.state.pitches, { home: 1 });
});

test('the order wraps at the bottom of the lineup', () => {
  const g = G({ lineups: { away: order([1, 1, 1]) }, state: { batIdx: { away: 2 } } });
  assert.equal(L.onOut(g).patch.state.batIdx.away, 0);
});

test('empty lineup slots are skipped, not batted', () => {
  const g = G({ lineups: { away: order([1, 0, 0, 1]) }, state: { batIdx: { away: 0 } } });
  assert.equal(L.onOut(g).patch.state.batIdx.away, 3);
});

test('only the batting team\'s order moves', () => {
  const g = G({ half: 'bottom', lineups: { away: order([1, 1]), home: order([1, 1]) },
                state: { batIdx: { away: 1, home: 0 } } });
  const r = L.onOut(g);
  assert.equal(r.patch.state.batIdx.home, 1);
  assert.equal(r.patch.state.batIdx.away, 1, 'the away order is where it was left');
});

test('with no lineup entered, nothing pretends to track an order', () => {
  const r = L.onOut(G());
  assert.equal(r.patch.state.batIdx, undefined);
});

test('Next Batter advances the order without counting a pitch', () => {
  const g = G({ balls: 2, strikes: 1, lineups: { away: order([1, 1]) }, state: { batIdx: { away: 0 } } });
  const r = L.onNextBatter(g);
  assert.equal(r.patch.state.batIdx.away, 1);
  assert.equal(r.patch.state.pitches, undefined);
  assert.equal(r.patch.balls, 0);
});

test('due up lists the next hitters, wrapping and skipping the empties', () => {
  const g = G({ lineups: { away: order([1, 1, 0, 1]) }, state: { batIdx: { away: 2 } } });
  assert.deepEqual(L.dueUp(g, 3).map((b) => b.name), ['B3', 'B0', 'B1']);
});

// ---------------------------------------------------------------------------
// Manual adjusters — the corrections, and their clamps
// ---------------------------------------------------------------------------
test('adjusters clamp at the bounds the database enforces', () => {
  assert.equal(L.adjustBalls(G({ balls: 4 }), 1).patch.balls, 4);
  assert.equal(L.adjustBalls(G({ balls: 0 }), -1).patch.balls, 0);
  assert.equal(L.adjustStrikes(G({ strikes: 3 }), 1).patch.strikes, 3);
  assert.equal(L.adjustOuts(G({ outs: 3 }), 1).patch.outs, 3);
  assert.equal(L.adjustOuts(G({ outs: 0 }), -1).patch.outs, 0);
  assert.equal(L.adjustScore(G(), 'away', -1).patch.away_score, 0, 'a score never goes negative');
});

test('nudging the inning never goes below the first', () => {
  assert.equal(L.onNudgeInning(G({ inning: 1 }), -1).patch.inning, 1);
  assert.equal(L.onNudgeInning(G({ inning: 3 }), 1).patch.line_score.length, 4);
});

test('a base toggles on and off without touching the others', () => {
  const r = L.toggleBase(G({ bases: bases(1, 0, 0) }), 'second');
  assert.deepEqual(r.patch.bases, bases(1, 1, 0));
  assert.deepEqual(L.toggleBase(G({ bases: bases(1, 1, 0) }), 'first').patch.bases, bases(0, 1, 0));
});

test('bases survive arriving as a JSON string', () => {
  assert.deepEqual(L.safeBases('{"first":true,"second":false,"third":true}'), bases(1, 0, 1));
  assert.deepEqual(L.safeBases('not json'), bases(0, 0, 0));
  assert.deepEqual(L.safeBases(null), bases(0, 0, 0));
});

// ---------------------------------------------------------------------------
// Walks and home runs
// ---------------------------------------------------------------------------
test('a walk forces runners only where it has to', () => {
  assert.deepEqual(L.computeWalk(bases(0, 0, 0)), { bases: bases(1, 0, 0), runs: 0 });
  assert.deepEqual(L.computeWalk(bases(1, 0, 1)), { bases: bases(1, 1, 1), runs: 0 }, 'first and third: nobody scores');
  assert.deepEqual(L.computeWalk(bases(0, 1, 1)), { bases: bases(1, 1, 1), runs: 0 }, 'second and third are not forced');
  assert.deepEqual(L.computeWalk(bases(1, 1, 1)), { bases: bases(1, 1, 1), runs: 1 }, 'bases loaded forces one in');
});

test('a home run scores the batter and everyone on', () => {
  assert.equal(L.computeHomeRun(bases(0, 0, 0)).runs, 1);
  assert.equal(L.computeHomeRun(bases(1, 0, 1)).runs, 3);
  assert.equal(L.computeHomeRun(bases(1, 1, 1)).runs, 4);
});

// ---------------------------------------------------------------------------
// Who is at bat, who is on the mound
// ---------------------------------------------------------------------------
test('the batting side follows the half, and the fielding side is the other one', () => {
  assert.equal(L.battingSide(G()), 'away');
  assert.equal(L.fieldingSide(G()), 'home');
  assert.equal(L.battingSide(G({ half: 'bottom' })), 'home');
});

test('the pitch count shown is the fielding team\'s', () => {
  const g = G({ state: { pitches: { away: 12, home: 40 } } });
  assert.equal(L.pitchCount(g), 40, 'top half: the home pitcher is working');
  assert.equal(L.pitchCount({ ...g, half: 'bottom' }), 12);
});

test('the pitch-count stepper never goes below zero', () => {
  assert.equal(L.adjustPitch(G({ state: { pitches: { home: 0 } } }), -1).patch.state.pitches.home, 0);
});

test('a half-filled lineup card reads as no hitter rather than a blank one', () => {
  assert.equal(L.currentBatter(G()), null);
  const g = G({ lineups: { away: order([1]) }, state: { batIdx: { away: 0 } } });
  assert.equal(L.currentBatter(g).name, 'B0');
});

test('the batting order card only fills in DH once a defense exists', () => {
  const noDefense = G({ lineups: { away: order([1, 1]) } });
  assert.deepEqual(L.battingOrderCard(noDefense, 'away').map((r) => r.pos), ['', '']);
  const withDefense = G({ lineups: { away: { ...order([1, 1]), positions: { C: 0 } } } });
  assert.deepEqual(L.battingOrderCard(withDefense, 'away').map((r) => r.pos), ['C', 'DH']);
});

// ---------------------------------------------------------------------------
// Offline undo (BUG-2) — dropping the newest queued play and replaying the rest
// ---------------------------------------------------------------------------
const ev = (patch) => ({ kind: 'event', patch });
const field = (patch) => ({ kind: 'field', patch });

test('drops the newest queued play and rebuilds the state before it', () => {
  const base = { id: 'g1', balls: 0 };
  const q = [ev({ balls: 1 }), ev({ balls: 2 }), ev({ balls: 3 })];
  const r = L.undoPending(base, q);
  assert.equal(r.state.balls, 2);
  assert.equal(r.rest.length, 2);
  assert.equal(r.dropped, q[2]);
  assert.equal(q.length, 3, 'does not mutate the caller\'s queue');
});

test('undoes repeatedly, one play at a time', () => {
  const base = { id: 'g1', balls: 0 };
  let r = L.undoPending(base, [ev({ balls: 1 }), ev({ balls: 2 }), ev({ balls: 3 })]);
  assert.equal(r.state.balls, 2);
  r = L.undoPending(base, r.rest); assert.equal(r.state.balls, 1);
  r = L.undoPending(base, r.rest); assert.equal(r.state.balls, 0);
  assert.equal(L.undoPending(base, r.rest), null);
});

test('keeps settings writes queued — they are not plays', () => {
  const base = { id: 'g1', balls: 0, theme: 'nightgame' };
  const r = L.undoPending(base, [ev({ balls: 1 }), field({ theme: 'chalkboard' }), ev({ balls: 2 })]);
  assert.equal(r.state.balls, 1);
  assert.equal(r.state.theme, 'chalkboard');
  assert.ok(r.rest.some((w) => w.kind === 'field'));
});

test('a settings write after the last play is not the undo target', () => {
  const r = L.undoPending({ id: 'g1', balls: 0, theme: 'a' }, [ev({ balls: 1 }), field({ theme: 'b' })]);
  assert.equal(r.dropped.kind, 'event');
  assert.equal(r.state.balls, 0);
  assert.equal(r.state.theme, 'b');
});

test('returns null when only settings are queued, so Undo can say so', () => {
  assert.equal(L.undoPending({ id: 'g1' }, [field({ theme: 'neon' })]), null);
  assert.equal(L.undoPending({ id: 'g1' }, []), null);
});

test('replays onto the baseline as it advances mid-drain', () => {
  const r = L.undoPending({ id: 'g1', balls: 1 }, [ev({ balls: 2 })]);
  assert.equal(r.state.balls, 1);
  assert.equal(r.rest.length, 0);
});

test('carries every field of a multi-field patch, not just the changed one', () => {
  const base = { id: 'g1', outs: 0, balls: 3, strikes: 2, half: 'top', inning: 1 };
  const roll = ev({ outs: 0, balls: 0, strikes: 0, half: 'bottom', inning: 1 });
  assert.deepEqual(L.undoPending(base, [roll]).state, base);
});

// ---------------------------------------------------------------------------
// Walk-off (PERF-1 turned this from a trigger into a predicate)
// ---------------------------------------------------------------------------
const W = (o) => ({ sport: 'baseball', regulation_innings: 6, half: 'bottom', inning: 6, home_score: 0, away_score: 0, ...o });

test('a walk-off is home taking the lead in the bottom of the final inning', () => {
  assert.equal(L.isWalkoff(W({ home_score: 2, away_score: 3 }), W({ home_score: 4, away_score: 3 })), true);
});

test('extra innings still count as the final inning or later', () => {
  assert.equal(L.isWalkoff(W({ inning: 9, home_score: 3, away_score: 3 }), W({ inning: 9, home_score: 4, away_score: 3 })), true);
});

test('not a walk-off when home was already ahead', () => {
  assert.equal(L.isWalkoff(W({ home_score: 5, away_score: 3 }), W({ home_score: 6, away_score: 3 })), false);
});

test('not a walk-off in the top half, before the final inning, or when tied', () => {
  assert.equal(L.isWalkoff(W({ half: 'top', home_score: 2, away_score: 3 }), W({ half: 'top', home_score: 4, away_score: 3 })), false);
  assert.equal(L.isWalkoff(W({ inning: 3, home_score: 2, away_score: 3 }), W({ inning: 3, home_score: 4, away_score: 3 })), false);
  assert.equal(L.isWalkoff(W({ home_score: 2, away_score: 3 }), W({ home_score: 3, away_score: 3 })), false);
});

test('opt-in: no regulation length set means no walk-off, ever', () => {
  const off = { regulation_innings: 0 };
  assert.equal(L.isWalkoff(W({ ...off, home_score: 2, away_score: 3 }), W({ ...off, home_score: 4, away_score: 3 })), false);
});

test('walk-off is baseball only', () => {
  const fb = { sport: 'football' };
  assert.equal(L.isWalkoff(W({ ...fb, home_score: 2, away_score: 3 }), W({ ...fb, home_score: 4, away_score: 3 })), false);
});

// ---------------------------------------------------------------------------
// The situation in words (UI-4) — what the situation button says out loud,
// since the bar itself is dots and a diamond.
// ---------------------------------------------------------------------------
test('the situation reads as a sentence, and counts agree with themselves', () => {
  assert.equal(L.situationSentence(G()),
    'Top of the 1st, 0 balls, 0 strikes, 0 outs, bases empty');
  assert.equal(L.situationSentence(G({ half: 'bottom', inning: 3, balls: 1, strikes: 1, outs: 1 })),
    'Bottom of the 3rd, 1 ball, 1 strike, 1 out, bases empty', 'singular at one, not "1 balls"');
  assert.equal(L.situationSentence(G({ inning: 2, balls: 3, strikes: 2, outs: 2 })),
    'Top of the 2nd, 3 balls, 2 strikes, 2 outs, bases empty');
});

test('innings past the third take the plain ordinal', () => {
  assert.ok(L.situationSentence(G({ inning: 4 })).startsWith('Top of the 4th'));
  assert.ok(L.situationSentence(G({ inning: 11 })).startsWith('Top of the 11th'));
});

test('the bases are described the way a broadcaster would', () => {
  assert.equal(L.basesPhrase(bases(0, 0, 0)), 'bases empty');
  assert.equal(L.basesPhrase(bases(1, 0, 0)), 'runner on first');
  assert.equal(L.basesPhrase(bases(0, 0, 1)), 'runner on third');
  assert.equal(L.basesPhrase(bases(1, 0, 1)), 'runners on first and third');
  assert.equal(L.basesPhrase(bases(0, 1, 1)), 'runners on second and third');
  assert.equal(L.basesPhrase(bases(1, 1, 1)), 'bases loaded', 'not "first and second and third"');
});

test('the sentence reads the bases even when they arrive as a JSON string', () => {
  assert.ok(L.situationSentence(G({ bases: '{"first":true,"second":false,"third":true}' }))
    .endsWith('runners on first and third'));
});

// ===========================================================================
// Stale inbound rows
// ===========================================================================
// Realtime delivers a backlog's worth of UPDATEs after the queue reports itself
// empty. Observed live: the pad had settled on 2-0 and then announced 0-0, 1-0
// and 2-0 again, one per delayed row. It ended correct only because delivery
// happened to be in order.
const at = (s) => ({ updated_at: s });

test('a row older than the last one adopted is stale', () => {
  assert.equal(L.rowIsStale(at('2026-09-08T13:27:03.4Z'), Date.parse('2026-09-08T13:27:03.6Z')), true);
});

test('a newer row is not stale', () => {
  assert.equal(L.rowIsStale(at('2026-09-08T13:27:04.0Z'), Date.parse('2026-09-08T13:27:03.6Z')), false);
});

test('the same row again is not stale — adopting it twice is harmless', () => {
  const t = '2026-09-08T13:27:03.6Z';
  assert.equal(L.rowIsStale(at(t), Date.parse(t)), false);
});

test('with nothing adopted yet, every row is taken', () => {
  assert.equal(L.rowIsStale(at('2026-09-08T13:27:03.4Z'), 0), false);
});

test('a row with no usable timestamp is taken, exactly as before the guard', () => {
  // Degrading to the old behaviour matters more than the guard: a row the pad
  // cannot date is still the only state it has.
  const last = Date.parse('2026-09-08T13:27:03.6Z');
  for (const row of [{}, { updated_at: null }, { updated_at: 'not a date' }, null, undefined]) {
    assert.equal(L.rowIsStale(row, last), false, `${JSON.stringify(row)} should not be stale`);
  }
});

test('rowStamp reads the column and returns 0 for anything unusable', () => {
  assert.equal(L.rowStamp(at('2026-09-08T13:27:03.600Z')), Date.parse('2026-09-08T13:27:03.600Z'));
  assert.equal(L.rowStamp({ updated_at: 'nope' }), 0);
  assert.equal(L.rowStamp({}), 0);
  assert.equal(L.rowStamp(null), 0);
});

test('replaying a drained backlog in order adopts only the last row', () => {
  // The exact live sequence: three updates broadcast while the queue drained,
  // delivered after it emptied. The pad is already on the newest.
  let lastAt = Date.parse('2026-09-08T13:27:03.666Z');   // the row the queue settled on
  const burst = ['13:27:03.429', '13:27:03.602', '13:27:03.666'].map((t) => at(`2026-09-08T${t}Z`));
  const taken = burst.filter((row) => {
    if (L.rowIsStale(row, lastAt)) return false;
    lastAt = Math.max(lastAt, L.rowStamp(row));
    return true;
  });
  assert.deepEqual(taken.map((r) => r.updated_at), ['2026-09-08T13:27:03.666Z']);
});

// ---------------------------------------------------------------------------
// Reordering the batting order (drag a row onto another slot)
// ---------------------------------------------------------------------------
test('swapping two slots trades the players', () => {
  const t = L.swapBatters(order([1, 1, 1]), 0, 2);
  assert.deepEqual(t.batters.map((b) => b.name), ['B2', 'B1', 'B0']);
});

test('a fielder keeps their position when they move in the order', () => {
  const team = { ...order([1, 1, 1, 1]), positions: { SS: 0, CF: 3, C: 1 } };
  const t = L.swapBatters(team, 0, 3);
  assert.deepEqual(t.positions, { SS: 3, CF: 0, C: 1 });
  assert.equal(t.batters[t.positions.SS].name, 'B0');
});

test('dropping onto an empty bench slot past the list pads it', () => {
  const t = L.swapBatters(order([1, 1]), 1, 10);
  assert.equal(t.batters.length, 11);
  assert.equal(t.batters[10].name, 'B1');
  assert.equal(t.batters[1].name, '');
});

test('the pitcher and the original roster are left alone', () => {
  const team = { ...order([1, 1]), pitcher: { num: '9', name: 'Ace' }, positions: { C: 0 } };
  const t = L.swapBatters(team, 0, 1);
  assert.deepEqual(t.pitcher, { num: '9', name: 'Ace' });
  assert.equal(team.batters[0].name, 'B0');
  assert.deepEqual(team.positions, { C: 0 });
});

// ---------------------------------------------------------------------------
// Balls in play: who fielded it, and where everyone ended up
// ---------------------------------------------------------------------------
const playOf = (g, kind, pos) => L.onPlay(g, { kind, pos, dest: L.playDefaults(g, kind) });

test('a grounder to short is a 6-3 groundout that ends the at-bat', () => {
  const g = G({ strikes: 1, balls: 2, lineups: { away: order([1, 1, 1]) } });
  const r = playOf(g, 'GB', 'SS');
  assert.equal(r.type, 'play');
  assert.equal(r.text, 'Groundout 6-3');
  assert.equal(r.patch.outs, 1);
  assert.equal(r.patch.balls, 0);
  assert.equal(r.patch.state.batIdx.away, 1, 'the order moves on');
  assert.deepEqual(r.patch.state.pitches, { home: 1 }, 'and the pitch counts');
  assert.equal(r.anim, 'play');
});

test('a fielder with no type picked: infield grounds out, outfield flies out', () => {
  for (const p of ['P', 'C', '1B', '2B', '3B', 'SS']) assert.equal(L.autoKind(p), 'GB', p);
  for (const p of ['LF', 'CF', 'RF']) assert.equal(L.autoKind(p), 'FB', p);
});

test('the scorebook codes read the way a scorer writes them', () => {
  assert.equal(L.playCode('GB', '1B'), '3U', 'the first baseman fielding it himself is unassisted');
  assert.equal(L.playCode('GB', 'P'), '1-3');
  assert.equal(L.playCode('FB', 'CF'), 'F8');
  assert.equal(L.playCode('LD', 'SS'), 'L6');
  assert.equal(L.playCode('PU', 'C'), 'P2');
  assert.equal(L.playCode('E', 'SS'), 'E6');
  assert.equal(L.playCode('DP', 'SS'), '6-4-3');
  assert.equal(L.playCode('DP', '2B'), '4-6-3');
  assert.equal(L.playCode('DP', '3B'), '5-4-3');
  assert.equal(L.playCode('SF', 'RF'), 'SF9');
  assert.equal(L.playCode('H1', null), '');
});

test('on a groundout, forced runners move up and the rest hold', () => {
  assert.deepEqual(L.playDefaults(G({ bases: bases(1, 0, 1) }), 'GB'), { batter: 'out', first: 2, third: 3 },
    'first is forced, third is not');
  assert.deepEqual(L.playDefaults(G({ bases: bases(1, 1, 1) }), 'GB'), { batter: 'out', first: 2, second: 3, third: 4 });
});

test('on a fly ball the runners hold, and on a sac fly the runner on third scores', () => {
  const g = G({ bases: bases(1, 0, 1) });
  assert.deepEqual(L.playDefaults(g, 'FB'), { batter: 'out', first: 1, third: 3 });
  const r = playOf(g, 'SF', 'CF');
  assert.equal(r.text, 'Sac fly SF8');
  assert.equal(r.payload.runs, 1);
  assert.equal(r.patch.away_score, 1);
  assert.deepEqual(r.patch.bases, bases(1, 0, 0));
});

test('a groundout scores the runner from third when you say he scored', () => {
  const r = L.onPlay(G({ bases: bases(0, 0, 1) }), { kind: 'GB', pos: 'SS', dest: { batter: 'out', third: 4 } });
  assert.equal(r.patch.away_score, 1);
  assert.equal(r.patch.line_score[0].top, 1);
  assert.equal(r.patch.outs, 1);
  assert.deepEqual(r.patch.bases, bases(0, 0, 0));
});

test('a double play is two outs and takes the runner from first', () => {
  const r = playOf(G({ bases: bases(1, 0, 0) }), 'DP', 'SS');
  assert.equal(r.patch.outs, 2);
  assert.deepEqual(r.patch.bases, bases(0, 0, 0));
  assert.equal(r.text, 'Double play 6-4-3');
  assert.equal(r.anim, 'doubleplay', 'still the double play stinger, and its auto-clip');
});

test('a fielder’s choice puts the batter on first and the lead forced runner out', () => {
  const r = playOf(G({ bases: bases(1, 0, 0) }), 'FC', 'SS');
  assert.equal(r.patch.outs, 1);
  assert.deepEqual(r.patch.bases, bases(1, 0, 0));
});

test('an error puts the batter on, moves everyone up, and is charged to the field', () => {
  const r = playOf(G({ bases: bases(0, 1, 0) }), 'E', 'SS');
  assert.equal(r.text, 'Reached on error E6');
  assert.deepEqual(r.patch.bases, bases(1, 0, 1));
  assert.equal(r.patch.home_errors, 1);
  assert.equal(r.patch.outs, 0, 'nobody is out');
  assert.equal(r.patch.away_hits, undefined, 'and it is not a hit');
});

test('a throwing error can take the batter to second', () => {
  const r = L.onPlay(G(), { kind: 'E', pos: 'SS', dest: { batter: 2 } });
  assert.deepEqual(r.patch.bases, bases(0, 1, 0));
});

test('a dropped third strike: the batter reaches and the runners move up', () => {
  const g = G({ strikes: 2, bases: bases(0, 1, 0) });
  assert.equal(L.playBlocked(g, 'K3'), '');
  const r = playOf(g, 'K3', 'C');
  assert.equal(r.text, 'Dropped 3rd strike');
  assert.deepEqual(r.patch.bases, bases(1, 0, 1));
  assert.equal(r.patch.outs, 0);
  assert.equal(r.patch.strikes, 0);
  assert.deepEqual(r.patch.state.pitches, { home: 1 }, 'the third strike is still a pitch');
});

test('the batter may only run on a dropped third strike with first open or two outs', () => {
  assert.notEqual(L.playBlocked(G({ strikes: 2, bases: bases(1, 0, 0) }), 'K3'), '');
  assert.equal(L.playBlocked(G({ strikes: 2, outs: 2, bases: bases(1, 0, 0) }), 'K3'), '');
  assert.notEqual(L.playBlocked(G({ strikes: 1 }), 'K3'), '', 'and only with two strikes on him');
});

test('plays that can’t have happened with these bases say why', () => {
  assert.notEqual(L.playBlocked(G(), 'DP'), '');
  assert.notEqual(L.playBlocked(G({ bases: bases(1, 0, 0), outs: 2 }), 'DP'), '');
  assert.notEqual(L.playBlocked(G({ bases: bases(1, 0, 0) }), 'SF'), '');
  assert.notEqual(L.playBlocked(G(), 'FC'), '');
  assert.equal(L.playBlocked(G(), 'GB'), '');
});

test('two runners finishing on the same base is refused, not recorded', () => {
  const g = G({ bases: bases(1, 1, 0) });
  const dest = { batter: 'out', first: 2, second: 2 };
  assert.equal(L.resolvePlay(g, dest).clash, 'second');
  assert.equal(L.onPlay(g, { kind: 'GB', pos: 'SS', dest }), null);
});

test('no run scores when the third out is the batter', () => {
  const r = L.onPlay(G({ outs: 2, bases: bases(0, 0, 1) }), { kind: 'FB', pos: 'CF', dest: { batter: 'out', third: 4 } });
  assert.equal(r.patch.half, 'bottom');
  assert.equal(r.payload.runs, 0);
  assert.equal(r.patch.away_score, undefined);
});

test('no run scores when the third out is a force', () => {
  const r = L.onPlay(G({ outs: 2, bases: bases(1, 0, 1) }), { kind: 'FC', pos: 'SS', dest: { batter: 1, first: 'out', third: 4 } });
  assert.equal(r.payload.runs, 0);
  assert.equal(r.patch.half, 'bottom');
});

test('a play that ends the half rolls it and clears the bases', () => {
  const r = playOf(G({ outs: 1, bases: bases(1, 0, 0) }), 'DP', '2B');
  assert.equal(r.patch.half, 'bottom');
  assert.equal(r.patch.outs, 0);
  assert.deepEqual(r.patch.bases, bases(0, 0, 0));
});

test('a hit through the runner step agrees with the one-tap hit', () => {
  for (const [kind, n] of [['H1', 1], ['H2', 2], ['H3', 3]]) {
    const g = G({ bases: bases(1, 0, 1) });
    const viaPlay = playOf(g, kind, null);
    const viaHit = L.onHit(g, n);
    assert.deepEqual(viaPlay.patch.bases, viaHit.patch.bases, kind);
    assert.equal(viaPlay.patch.away_score, viaHit.patch.away_score, kind);
    assert.equal(viaPlay.patch.away_hits, 1, kind);
  }
});

test('a runner thrown out on a hit is an out, and the hit still counts', () => {
  const r = L.onPlay(G({ bases: bases(1, 0, 0) }), { kind: 'H1', dest: { batter: 1, first: 'out' } });
  assert.equal(r.patch.outs, 1);
  assert.equal(r.patch.away_hits, 1);
  assert.deepEqual(r.patch.bases, bases(1, 0, 0));
});

test('the stinger carries the batter’s slot, never a name — the row is public', () => {
  const g = G({ lineups: { away: order([1, 1, 1]) }, state: { batIdx: { away: 2 } } });
  const r = playOf(g, 'GB', 'SS');
  assert.deepEqual(r.animMeta, { text: 'Groundout 6-3', side: 'away', idx: 2, runs: 0 });
  assert.ok(!JSON.stringify(r.payload).includes('B2'), 'and no roster name in the event log either');
});

// ---------------------------------------------------------------------------
// The play-by-play note every at-bat leaves (copied to the public recap)
// ---------------------------------------------------------------------------
test('a strikeout and a plain out each leave a note for the play-by-play', () => {
  const k = L.onStrike(G({ strikes: 2, inning: 3 }));
  assert.deepEqual(k.payload.play, { kind: 'K', pos: null, code: '', outs: 1, runs: 0, inning: 3, half: 'top' });
  const o = L.onOut(G());
  assert.equal(o.payload.play.kind, 'OUT');
});

test('the note keeps the half the play happened in, not the one the third out rolled to', () => {
  const r = L.onOut(G({ outs: 2, inning: 5, half: 'bottom' }));
  assert.equal(r.patch.half, 'top');
  assert.equal(r.patch.inning, 6);
  assert.deepEqual([r.payload.play.inning, r.payload.play.half], [5, 'bottom']);
  assert.equal(r.payload.rolled, true, 'and the roll is still reported');
});

test('a ball in play leaves its code and fielder, and nothing about who batted', () => {
  const g = G({ lineups: { away: order([1, 1]) }, bases: bases(0, 0, 1) });
  const r = L.onPlay(g, { kind: 'SF', pos: 'CF', dest: L.playDefaults(g, 'SF') });
  assert.deepEqual(r.payload.play, { kind: 'SF', pos: 'CF', code: 'SF8', outs: 1, runs: 1, inning: 1, half: 'top' });
});

// ---------------------------------------------------------------------------
// Positions from the lineup sheet's dropdowns
// ---------------------------------------------------------------------------
const roster = () => ({
  batters: [{ num: '3', name: 'Morales' }, { num: '11', name: 'Carter' }, { num: '12', name: 'Reyes' }, { num: '7', name: 'Jensen' }],
  positions: { SS: 1, '2B': 2 },
  pitcher: { num: '7', name: 'Jensen' },
});

test('picking a position someone holds sends them to the bench, not into a swap', () => {
  const { team, benched } = L.setPosition(roster(), 2, 'SS');
  assert.equal(team.positions.SS, 2);
  assert.equal(team.positions['2B'], undefined, 'Reyes left second base');
  assert.equal(benched, 1);
  assert.equal(L.positionOf(team, 1), '', 'Carter is off the field');
});

test('P makes that row the pitcher, and benches the old one', () => {
  const { team, benched } = L.setPosition(roster(), 0, 'P');
  assert.deepEqual(team.pitcher, { num: '3', name: 'Morales' });
  assert.equal(benched, 3);
  assert.equal(L.positionOf(team, 0), 'P');
  assert.equal(L.positionOf(team, 3), '');
});

test('moving the pitcher to a field spot clears the mound', () => {
  const { team } = L.setPosition(roster(), 3, 'CF');
  assert.deepEqual(team.pitcher, { num: '', name: '' });
  assert.equal(team.positions.CF, 3);
  assert.ok(L.missingPositions(team).includes('P'));
});

test('taking a player out of the field benches nobody else', () => {
  const { team, benched } = L.setPosition(roster(), 1, '');
  assert.equal(team.positions.SS, undefined);
  assert.equal(benched, -1);
});

test('the field check lists the empty spots in field order', () => {
  assert.deepEqual(L.missingPositions(roster()), ['C', '1B', '3B', 'LF', 'CF', 'RF']);
  assert.deepEqual(L.missingPositions({}), L.FIELD_POSITIONS);
});

test('renaming the pitcher’s row carries the pitcher with it, and keeps the defense', () => {
  const r = roster();
  const out = L.setBatterField(L.setBatterField(r, 3, 'name', 'Jensen Jr'), 3, 'num', '17');
  assert.deepEqual(out.pitcher, { num: '17', name: 'Jensen Jr' });
  assert.deepEqual(out.positions, r.positions);
  assert.equal(L.currentPitcher({ half: 'bottom', lineups: { away: out } }).name, 'Jensen Jr');
});

test('one typed field touches one row and nothing else', () => {
  const r = roster();
  const out = L.setBatterField(r, 1, 'name', 'Carter Jr');
  assert.equal(out.batters[1].name, 'Carter Jr');
  assert.equal(out.batters[1].num, '11', 'the number on that row is left alone');
  assert.deepEqual(out.batters.filter((_, i) => i !== 1), r.batters.filter((_, i) => i !== 1));
  assert.deepEqual(out.positions, r.positions);
  assert.deepEqual(r.batters[1], { num: '11', name: 'Carter' }, 'the stored roster is not mutated');
});

test('typing into an empty slot past the end of the order fills only that slot', () => {
  const out = L.setBatterField(roster(), 6, 'num', '22');
  assert.equal(out.batters.length, 7);
  assert.deepEqual(out.batters[6], { num: '22', name: '' });
  assert.deepEqual(out.batters[4], { num: '', name: '' });
  assert.equal(L.positionOf(out, 1), 'SS', 'the defense still points at the same players');
});

test('a position set from the sheet is what the fielder tray and defense card read', () => {
  const { team } = L.setPosition(roster(), 0, 'LF');
  const g = { half: 'top', lineups: { home: team } };
  assert.equal(L.fielderAt(g, 'home', 'LF').name, 'Morales');
  assert.equal(L.fielderAt(g, 'home', 'P').name, 'Jensen');
});

// ---------------------------------------------------------------------------
// Strike three looking, hit by pitch
// ---------------------------------------------------------------------------
test('strike three looking is the same out with its own note and stinger', () => {
  const sw = L.onStrike(G({ strikes: 2 }));
  const lk = L.onStrike(G({ strikes: 2 }), { looking: true });
  assert.equal(sw.payload.play.kind, 'K');
  assert.equal(sw.anim, 'strikeout');
  assert.equal(lk.payload.play.kind, 'KL');
  assert.equal(lk.anim, 'strikeoutlooking');
  assert.deepEqual(lk.patch, sw.patch, 'the game moves the same either way');
});

test('hit by pitch puts the batter on first, forces runners, counts the pitch', () => {
  const r = L.onHitByPitch(G({ balls: 1, strikes: 2, bases: bases(1, 1, 1), lineups: { away: order([1, 1, 1]) } }));
  assert.equal(r.type, 'hbp');
  assert.deepEqual(r.patch.bases, bases(1, 1, 1));
  assert.equal(r.patch.away_score, 1, 'bases loaded forces a run in');
  assert.equal(r.patch.balls, 0);
  assert.deepEqual(r.patch.state.pitches, { home: 1 });
  assert.equal(r.patch.state.batIdx.away, 1, 'next batter up');
  assert.equal(r.payload.play.kind, 'HBP');
  assert.equal(r.payload.runs, 1);
});

test('hit by pitch with nobody forced leaves runners where they are', () => {
  const r = L.onHitByPitch(G({ bases: bases(0, 1, 1) }));
  assert.deepEqual(r.patch.bases, bases(1, 1, 1));
  assert.equal(r.payload.runs, 0);
});

// ---------------------------------------------------------------------------
// Runner plays: steals, caught stealing, pickoffs
// ---------------------------------------------------------------------------
test('caught stealing is an out that keeps the count and the batter', () => {
  const r = L.onRunnerPlay(G({ balls: 2, strikes: 1, outs: 0, bases: bases(1, 0, 0), state: { batIdx: { away: 3 } } }), 'first', 'CS');
  assert.equal(r.patch.outs, 1);
  assert.deepEqual(r.patch.bases, bases(0, 0, 0));
  assert.equal(r.patch.balls, undefined, 'count untouched');
  assert.equal(r.patch.state, undefined, 'same batter, no pitch');
  assert.equal(r.payload.play.kind, 'CS');
});

test('caught stealing for the third out ends the half', () => {
  const r = L.onRunnerPlay(G({ outs: 2, strikes: 2, bases: bases(1, 1, 0) }), 'second', 'CS');
  assert.equal(r.patch.half, 'bottom');
  assert.equal(r.patch.outs, 0);
  assert.deepEqual(r.patch.bases, bases(0, 0, 0));
});

test('a steal moves the runner one base; stealing home scores', () => {
  const s = L.onRunnerPlay(G({ bases: bases(1, 0, 0) }), 'first', 'SB');
  assert.deepEqual(s.patch.bases, bases(0, 1, 0));
  assert.equal(s.anim, 'stolenbase');
  const h = L.onRunnerPlay(G({ bases: bases(0, 0, 1) }), 'third', 'SB');
  assert.deepEqual(h.patch.bases, bases(0, 0, 0));
  assert.equal(h.patch.away_score, 1);
  assert.equal(h.payload.runs, 1);
});

test('a runner cannot steal onto an occupied base', () => {
  assert.ok(L.runnerBlocked(G({ bases: bases(1, 1, 0) }), 'first', 'SB'));
  assert.equal(L.onRunnerPlay(G({ bases: bases(1, 1, 0) }), 'first', 'SB'), null);
  assert.equal(L.runnerBlocked(G({ bases: bases(1, 1, 0) }), 'first', 'CS'), '');
});

// ---------------------------------------------------------------------------
// Field screen: trade spots
// ---------------------------------------------------------------------------
const fieldTeam = () => ({
  batters: [0, 1, 2, 3].map((i) => ({ num: String(10 + i), name: 'K' + i })),
  positions: { '1B': 0, '3B': 1 }, pitcher: { num: '12', name: 'K2' },
});
test('moving a kid onto a taken spot trades the two', () => {
  const { team, moved } = L.assignSpot(fieldTeam(), '3B', 0);
  assert.equal(L.slotAt(team, '3B'), 0);
  assert.equal(L.slotAt(team, '1B'), 1, 'the old 3B takes 1B');
  assert.deepEqual(moved, { idx: 1, to: '1B' });
});
test('trading with the pitcher moves the pitcher too', () => {
  const { team } = L.assignSpot(fieldTeam(), 'P', 0);
  assert.equal(L.slotAt(team, 'P'), 0);
  assert.equal(team.pitcher.num, '10');
  assert.equal(L.slotAt(team, '1B'), 2, 'old pitcher plays 1B');
});
test('a kid off the bench sends the one he replaces to the bench', () => {
  const { team, moved } = L.assignSpot(fieldTeam(), '1B', 3);
  assert.equal(L.slotAt(team, '1B'), 3);
  assert.equal(L.positionOf(team, 0), '');
  assert.deepEqual(moved, { idx: 0, to: '' });
});
test('an empty spot just takes the kid', () => {
  const { team, moved } = L.assignSpot(fieldTeam(), 'SS', 3);
  assert.equal(L.slotAt(team, 'SS'), 3);
  assert.equal(moved, null);
});

// ---------------------------------------------------------------------------
// Mid-Inning goes up on its own, except when the half ended the game
// ---------------------------------------------------------------------------
test('a half that ends a regulation game is not a mid-inning', () => {
  assert.equal(L.halfEndsGame({ regulation_innings: 6, half: 'bottom', inning: 6, home_score: 5, away_score: 3 }), true);
  assert.equal(L.halfEndsGame({ regulation_innings: 6, half: 'bottom', inning: 6, home_score: 3, away_score: 5 }), false);
  assert.equal(L.halfEndsGame({ regulation_innings: 6, half: 'top', inning: 7, home_score: 3, away_score: 5 }), true);
  assert.equal(L.halfEndsGame({ regulation_innings: 6, half: 'top', inning: 7, home_score: 4, away_score: 4 }), false);
  assert.equal(L.halfEndsGame({ regulation_innings: 6, half: 'top', inning: 4, home_score: 0, away_score: 9 }), false);
  assert.equal(L.halfEndsGame({ regulation_innings: 0, half: 'top', inning: 9, home_score: 0, away_score: 9 }), false);
});
