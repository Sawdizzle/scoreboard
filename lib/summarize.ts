// A finished (or running) game as facts: the line score, every run and how it
// scored, the lead changes, the big moments, the pitching changes and who
// stood out. This is what the AI writers are handed, and all they are handed,
// so a recap can only say what the play log says.
//
// Pure: it reads the game row, its play log (game_events, oldest first) and,
// for games scored on the pad, the stat rows those plays wrote. Undo deletes
// a play and its stat rows, so the log holds only plays that stand.
//
// Two kinds of log:
//   - the pad's: each event keeps the game as it stood before it (prev_live),
//     so the runs a play scored are the score after it less the score before;
//   - v4's (payload.source 'v4'): no prev_live, but each play's note carries
//     its inning, half and runs.
//
// Names come only from the lineups passed in. The caller passes the public
// lineups (lineup_public), so a player's public-name setting holds here too;
// a player with no name shown is "#12", and one with neither is left out.
import * as L from './rules/logic.js';
import { paText, ordinal } from './onair.ts';
import { paKind, type Res } from './scoring.ts';
import { innings as ipText } from './stats.ts';
import type { Lineup, Side } from './types.ts';

type Live = Record<string, unknown>;
type Half = 'top' | 'bottom';
type Note = { kind?: string; code?: string; inning?: number; half?: Half; runs?: number; outs?: number; pos?: string | null };

export type SummaryEvent = { id: number; seq: number; type: string; payload: Record<string, unknown> | null; prev_live: Live | null };
export type SummaryStat = {
  event_id: number; side: Side; bid: string;
  b_pa?: number; b_ab?: number; b_h?: number; b_2b?: number; b_3b?: number; b_hr?: number; b_rbi?: number; b_r?: number;
  b_bb?: number; b_so?: number; b_hbp?: number; b_sb?: number;
  p_outs?: number; p_bf?: number; p_h?: number; p_r?: number; p_er?: number; p_bb?: number; p_so?: number; p_pitches?: number;
};
export type SummaryInput = {
  game: { is_home: boolean; status: string; live: Live; sport?: string | null };
  teams: Record<Side, string>;
  events: SummaryEvent[];
  stats?: SummaryStat[];
  lineups?: Partial<Record<Side, Lineup | null>>;
  // The season's game length and the stream's run-rule margin, when set.
  regulationInnings?: number | null;
  runRule?: number | null;
};

export type Score = Record<Side, number>;
export type ScoringPlay = {
  inning: number; half: Half; side: Side; runs: number; score: Score;
  // "Home run", "Single", "Stolen base", "Run scored" ...; "Score corrected" for a fix on the Situation screen.
  what: string; kind: string; batter: string | null; scorers: string[]; correction?: true;
  // In a half with gaps: the runs are right, but not when in the half they
  // scored, so the score shown is only a lower bound. Never say it.
  partial?: true;
};
export type Moment = { kind: 'HR' | 'GS' | 'DP' | 'walkoff' | 'comeback' | 'run_rule' | 'shutout' | 'big_inning'; side: Side; inning: number | null; half: Half | null; text: string };
export type GameFacts = {
  sport: string; status: string; final: boolean; source: 'pad' | 'v4' | 'none';
  teams: Record<Side, string> & { home: Side };
  score: Score; result: 'W' | 'L' | 'T' | null;
  inningsPlayed: number; regulationInnings: number | null;
  lineScore: { innings: { inning: number; us: number | null; them: number | null }[]; us: { r: number; h: number; e: number }; them: { r: number; h: number; e: number } };
  scoringPlays: ScoringPlay[];
  leadChanges: { inning: number; half: Half; side: Side; score: Score }[];
  ties: number;
  // The most a side trailed by at any point.
  biggestDeficit: Record<Side, number>;
  moments: Moment[];
  // Strikeouts each side's pitchers recorded.
  strikeouts: Score;
  pitchingChanges: { inning: number; half: Half; side: Side; pitcher: string | null }[];
  standouts: { side: Side; name: string; line: string }[];
  // Halves where the line score has more runs than the plays explain (a run
  // tapped in by hand, or a v4 log with holes): the writers may give the
  // inning's total but must not say how those runs scored.
  gaps: { inning: number; half: Half; side: Side; runs: number }[];
  // The plays' runs add up to the line score and the final score.
  runsMatchScore: boolean;
};

const num = (v: unknown) => Number(v) || 0;
const BASEBALL = new Set(['baseball', 'softball']);
const STRIKEOUTS = new Set(['K', 'KL', 'K3']);
const WORDS: Record<string, string> = { run: 'Run scored', advance: 'Runners advanced', balk: 'Balk', 'adj-score': 'Score corrected' };

// A player by id, as the public may see them: the name, else the number.
function namer(lineups: SummaryInput['lineups']) {
  return (side: Side, bid: string | null | undefined): string | null => {
    if (!bid) return null;
    const b = lineups?.[side]?.batters?.find((x) => x.bid === bid);
    if (b?.name) return b.name;
    if (b?.num) return `#${b.num}`;
    const p = lineups?.[side]?.pitcher;
    return lineups?.[side]?.positions?.P === bid && p ? p.name || (p.num ? `#${p.num}` : null) : null;
  };
}

// One event as the facts read it: the play's note (v4 and most pad plays carry
// one), the inning and half it happened in, and its scorebook kind.
export function readEvent(e: SummaryEvent) {
  const note = ((e.payload ?? {}) as { play?: Note }).play ?? {};
  const before = e.prev_live ?? {};
  const inning = num(note.inning) || num(before.inning) || 1;
  const half: Half = note.half ?? (before.half === 'bottom' ? 'bottom' : 'top');
  const kind = note.kind ?? paKind({ type: e.type, patch: {}, payload: e.payload ?? {} } as Res, {} as never) ?? e.type;
  // Whether this play ended a plate appearance.
  const runnerBI = ((e.payload ?? {}) as { subject?: string }).subject === 'runner@third';
  const pa = !runnerBI && !!(note.kind ? PA_KINDS.has(note.kind) : paKind({ type: e.type, patch: {}, payload: e.payload ?? {} } as Res, {} as never));
  return { note, inning, half, kind, pa };
}
const PA_KINDS = new Set(['BB', 'IBB', 'HBP', 'CI', 'K', 'KL', 'K3', 'OUT', 'HR', 'H1', 'H2', 'H3', 'GB', 'FB', 'LD', 'PU', 'E', 'FC', 'DP', 'SF', 'SAC', 'BI']);

export function summarizeGame(input: SummaryInput): GameFacts {
  const { game, teams, events } = input;
  const stats = input.stats ?? [];
  const name = namer(input.lineups);
  const live = game.live ?? {};
  const home: Side = game.is_home ? 'us' : 'them';
  const away: Side = game.is_home ? 'them' : 'us';
  const batting = (half: Half): Side => (half === 'top' ? away : home);
  const scoreOf = (l: Live): Score => ({ [home]: num(l.home_score), [away]: num(l.away_score) }) as Score;
  const sport = game.sport || 'baseball';
  const final = game.status === 'final';
  const reg = input.regulationInnings || null;

  const score = scoreOf(live);
  const result = !final ? null : score.us > score.them ? 'W' : score.us < score.them ? 'L' : 'T';

  const rows = Array.isArray(live.line_score) ? (live.line_score as { top?: number | null; bottom?: number | null }[]) : [];
  const cell = (v: unknown) => (v === null || v === undefined || v === '' ? null : num(v));
  const lineScore: GameFacts['lineScore'] = {
    innings: rows.map((r, i) => ({ inning: i + 1, [away]: cell(r?.top), [home]: cell(r?.bottom) }) as GameFacts['lineScore']['innings'][number]),
    us: { r: score.us, h: num(live[game.is_home ? 'home_hits' : 'away_hits']), e: num(live[game.is_home ? 'home_errors' : 'away_errors']) },
    them: { r: score.them, h: num(live[game.is_home ? 'away_hits' : 'home_hits']), e: num(live[game.is_home ? 'away_errors' : 'home_errors']) },
  };

  const facts: GameFacts = {
    sport, status: game.status, final, source: 'none',
    teams: { ...teams, home }, score, result,
    inningsPlayed: num(live.inning) || rows.length, regulationInnings: reg,
    lineScore, scoringPlays: [], leadChanges: [], ties: 0, biggestDeficit: { us: 0, them: 0 },
    moments: [], strikeouts: { us: 0, them: 0 }, pitchingChanges: [], standouts: [], gaps: [], runsMatchScore: true,
  };
  // The other sports keep score only; their log is not plays.
  if (!BASEBALL.has(sport)) return facts;

  const v4 = events.some((e) => e.payload?.source === 'v4');
  facts.source = events.length ? (v4 ? 'v4' : 'pad') : 'none';

  const byEvent = new Map<number, SummaryStat[]>();
  for (const s of stats) byEvent.set(s.event_id, [...(byEvent.get(s.event_id) ?? []), s]);

  // Walk the log, keeping the score as it went.
  let run: Score = { us: 0, them: 0 };
  let leader: Side | null = null;
  events.forEach((e, i) => {
    const p = (e.payload ?? {}) as { play?: Note; inputs?: { side?: 'home' | 'away'; to?: string | null } };
    const before = e.prev_live ?? {};
    const { note, inning, half, kind } = readEvent(e);
    const side = batting(half);
    const mine = byEvent.get(e.id) ?? [];
    const batter = name(side, mine.find((s) => s.b_pa)?.bid);

    if (STRIKEOUTS.has(kind)) facts.strikeouts[side === 'us' ? 'them' : 'us'] += 1;
    if (e.type === 'pitcher' && p.inputs?.side) {
      const pside: Side = p.inputs.side === 'home' ? home : away;
      facts.pitchingChanges.push({ inning, half, side: pside, pitcher: name(pside, p.inputs.to) });
    }

    // Runs on this play, by side: v4 says so; the pad's are the score after less before.
    let delta: Score;
    if (v4) delta = { us: 0, them: 0, [side]: num(note.runs) } as Score;
    else {
      const after = scoreOf(i + 1 < events.length ? events[i + 1].prev_live ?? {} : live);
      const was = scoreOf(before);
      delta = { us: after.us - was.us, them: after.them - was.them };
    }
    const correction = e.type.startsWith('adj');
    for (const s of ['us', 'them'] as Side[]) {
      if (!delta[s]) continue;
      run = { ...run, [s]: run[s] + delta[s] };
      if (delta[s] < 0 && !correction) continue;
      const scorers = mine.filter((x) => x.side === s && x.b_r).map((x) => name(s, x.bid)).filter((x): x is string => !!x);
      facts.scoringPlays.push({
        inning, half, side: s, runs: delta[s], score: { ...run },
        what: correction ? WORDS['adj-score'] : (L.PLAY_LABEL as Record<string, string>)[kind] ? paText({ kind, code: note.code ?? null }) : WORDS[e.type] ?? kind,
        kind, batter: s === side ? batter : null, scorers, ...(correction ? { correction: true as const } : {}),
      });
    }
    if (delta.us || delta.them) {
      const now: Side | null = run.us > run.them ? 'us' : run.them > run.us ? 'them' : null;
      if (now && leader && now !== leader) facts.leadChanges.push({ inning, half, side: now, score: { ...run } });
      if (!now && leader) facts.ties += 1;
      if (now) leader = now;
      facts.biggestDeficit.us = Math.max(facts.biggestDeficit.us, run.them - run.us);
      facts.biggestDeficit.them = Math.max(facts.biggestDeficit.them, run.us - run.them);
    }

    if (kind === 'HR') {
      const runs = num(note.runs) || delta[side];
      facts.moments.push({ kind: runs >= 4 ? 'GS' : 'HR', side, inning, half,
        text: `${batter ?? 'A batter'} ${runs >= 4 ? 'hit a grand slam' : `homered${runs > 1 ? ` (${runs} runs)` : ''}`}` });
    }
    if (kind === 'DP') facts.moments.push({ kind: 'DP', side: side === 'us' ? 'them' : 'us', inning, half, text: `Double play ${note.code ?? ''}`.trim() });
  });
  if (facts.source !== 'none') {
    for (const r of lineScore.innings) for (const s of ['us', 'them'] as Side[]) {
      const half: Half = s === away ? 'top' : 'bottom';
      const logged = facts.scoringPlays.filter((x) => x.inning === r.inning && x.half === half && x.side === s).reduce((a, x) => a + x.runs, 0);
      if ((r[s] ?? 0) > logged) facts.gaps.push({ inning: r.inning, half, side: s, runs: (r[s] ?? 0) - logged });
    }
    facts.runsMatchScore = !facts.gaps.length && run.us === score.us && run.them === score.them;
    if (facts.gaps.length) reconcile(facts, away);
  }

  // Big innings: five runs or more in one half, from the line score.
  for (const r of lineScore.innings) for (const s of ['us', 'them'] as Side[]) {
    const n = r[s] ?? 0;
    if (n >= 5) facts.moments.push({ kind: 'big_inning', side: s, inning: r.inning, half: s === away ? 'top' : 'bottom', text: `${n}-run ${ordinal(r.inning)}` });
  }

  if (final && result !== 'T') {
    const winner: Side = result === 'W' ? 'us' : 'them';
    const loser: Side = winner === 'us' ? 'them' : 'us';
    // The Final card's own judgement of walk-off and run rule, so the two never disagree.
    const story = L.finalStory({ ...live, sport, regulation_innings: reg ?? 0, run_rule_diff: input.runRule ?? 0 }) as { walkoff: boolean; runRule: boolean };
    const last = facts.scoringPlays.filter((s) => s.side === winner && !s.correction).at(-1);
    if (story.walkoff) facts.moments.push({ kind: 'walkoff', side: home, inning: last?.inning ?? null, half: 'bottom', text: `Walk-off${last ? `: ${last.what}` : ''}` });
    if (story.runRule) facts.moments.push({ kind: 'run_rule', side: winner, inning: facts.inningsPlayed, half: null, text: `Ended by the run rule after ${facts.inningsPlayed}` });
    if (facts.biggestDeficit[winner] >= 2) facts.moments.push({ kind: 'comeback', side: winner, inning: null, half: null, text: `Came back from ${facts.biggestDeficit[winner]} down` });
    if (score[loser] === 0) facts.moments.push({ kind: 'shutout', side: winner, inning: null, half: null, text: 'Shutout' });
  }

  facts.standouts = standouts(stats, name);
  return facts;
}

// A log with gaps: its running score falls behind the line score at the first
// gap and stays behind. Restart each half from the line score, flag the scores
// inside a half with gaps as unknown, and judge leads and ties from what is
// known: every play in a whole half, and only the end of a half with gaps.
function reconcile(facts: GameFacts, away: Side) {
  const halves: { inning: number; half: Half; side: Side; start: Score; end: Score }[] = [];
  let at: Score = { us: 0, them: 0 };
  for (const r of facts.lineScore.innings) for (const half of ['top', 'bottom'] as Half[]) {
    const side: Side = half === 'top' ? away : away === 'us' ? 'them' : 'us';
    const end = { ...at, [side]: at[side] + (r[side] ?? 0) } as Score;
    halves.push({ inning: r.inning, half, side, start: at, end });
    at = end;
  }
  const gap = (inning: number, half: Half) => facts.gaps.some((g) => g.inning === inning && g.half === half);

  const steps: { inning: number; half: Half; score: Score }[] = [];
  for (const h of halves) {
    let now = { ...h.start };
    for (const p of facts.scoringPlays) {
      if (p.inning !== h.inning || p.half !== h.half || p.correction) continue;
      now = { ...now, [p.side]: now[p.side] + p.runs };
      p.score = { ...now };
      if (gap(h.inning, h.half)) p.partial = true;
      else steps.push({ inning: h.inning, half: h.half, score: p.score });
    }
    if (gap(h.inning, h.half)) steps.push({ inning: h.inning, half: h.half, score: h.end });
  }

  facts.leadChanges = []; facts.ties = 0; facts.biggestDeficit = { us: 0, them: 0 };
  let leader: Side | null = null;
  for (const st of steps) {
    const now: Side | null = st.score.us > st.score.them ? 'us' : st.score.them > st.score.us ? 'them' : null;
    if (now && leader && now !== leader) facts.leadChanges.push({ inning: st.inning, half: st.half, side: now, score: st.score });
    if (!now && leader) facts.ties += 1;
    if (now) leader = now;
    facts.biggestDeficit.us = Math.max(facts.biggestDeficit.us, st.score.them - st.score.us);
    facts.biggestDeficit.them = Math.max(facts.biggestDeficit.them, st.score.us - st.score.them);
  }
}

// Who stood out: up to three of ours and two of theirs, hitting or pitching.
function standouts(stats: SummaryStat[], name: (s: Side, bid: string) => string | null) {
  const lines = new Map<string, SummaryStat>();
  for (const s of stats) {
    const key = `${s.side}:${s.bid}`;
    const a = lines.get(key) ?? { event_id: 0, side: s.side, bid: s.bid };
    for (const [k, v] of Object.entries(s)) if (typeof v === 'number' && k !== 'event_id') (a as Record<string, unknown>)[k] = num((a as Record<string, unknown>)[k]) + v;
    lines.set(key, a);
  }
  const hit = (l: SummaryStat) => num(l.b_h) + num(l.b_2b) + 2 * num(l.b_3b) + 3 * num(l.b_hr) + num(l.b_rbi) + num(l.b_r) + 0.5 * (num(l.b_sb) + num(l.b_bb));
  const pitch = (l: SummaryStat) => num(l.p_outs) / 3 + num(l.p_so) - num(l.p_er) / 2;
  const text = (l: SummaryStat) => {
    const parts: string[] = [];
    if (num(l.b_pa)) {
      const bits = [`${num(l.b_h)}-${num(l.b_ab)}`];
      const add = (v: number | undefined, label: string) => { if (num(v)) bits.push(num(v) > 1 ? `${num(v)} ${label}` : label); };
      add(l.b_hr, 'HR'); add(l.b_3b, '3B'); add(l.b_2b, '2B'); add(l.b_rbi, 'RBI'); add(l.b_r, 'R'); add(l.b_bb, 'BB'); add(l.b_sb, 'SB');
      parts.push(bits.join(', '));
    }
    if (num(l.p_outs)) parts.push(`${ipText(num(l.p_outs))} IP, ${num(l.p_so)} K, ${num(l.p_r)} R`);
    return parts.join('; ');
  };
  const ranked = [...lines.values()].map((l) => ({ l, score: Math.max(hit(l), pitch(l)), who: name(l.side, l.bid) }))
    .filter((x) => x.who && x.score >= 2).sort((a, b) => b.score - a.score);
  return [...ranked.filter((x) => x.l.side === 'us').slice(0, 3), ...ranked.filter((x) => x.l.side === 'them').slice(0, 2)]
    .map((x) => ({ side: x.l.side, name: x.who!, line: text(x.l) }));
}
