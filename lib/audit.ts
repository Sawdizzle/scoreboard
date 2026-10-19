// The scoring check: what in a game's log is likely a scoring slip, found when
// the scorer taps End game (and shown again on the game page after). It reads
// the same log and stat rows the recap does, and says each thing in words a
// scorer can act on. It never blocks anything: End anyway is always there.
//
//   fix   it changes someone's stats or what a recap can say
//   note  worth a look, but it may well be right
//
// Our side is checked closely. The other side only where its lineup was
// filled in: a team that does not keep the opponent's lineup is not nagged.
import * as L from './rules/logic.js';
import { ordinal } from './onair.ts';
import { readEvent, summarizeGame, type SummaryInput, type SummaryStat } from './summarize.ts';
import type { Lineup, Side } from './types.ts';

export type Issue = { level: 'fix' | 'note'; code: string; text: string };

const HITS = new Set(['H1', 'H2', 'H3', 'HR']);
const num = (v: unknown) => Number(v) || 0;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const where = (inning: number, half: 'top' | 'bottom') => `${half === 'top' ? 'Top' : 'Bottom'} of the ${ordinal(inning)}`;
const known = (l: Lineup | null | undefined) => !!l?.batters?.some((b) => b.num || b.name);

// `ending`: the check runs as the scorer taps End game, before the game is final.
export function auditGame(input: SummaryInput & { ending?: boolean }): Issue[] {
  const game = { ...input.game, status: input.ending ? 'final' : input.game.status };
  const facts = summarizeGame({ ...input, game });
  if (facts.source === 'none') return [];
  const out: Issue[] = [];
  const home: Side = game.is_home ? 'us' : 'them';
  const away: Side = game.is_home ? 'them' : 'us';
  const name = (s: Side) => facts.teams[s];
  const live = game.live ?? {};

  // Runs nothing explains: a v4 log with holes, or the score changed by hand.
  for (const g of facts.gaps) {
    out.push({ level: 'fix', code: 'gap', text: `${where(g.inning, g.half)}: ${plural(g.runs, 'run')} for ${name(g.side)} with no play that scored ${g.runs === 1 ? 'it' : 'them'}. Recaps give the inning's total but not how.` });
  }
  for (const s of facts.scoringPlays) {
    if (s.correction && s.runs > 0) out.push({ level: 'fix', code: 'adjusted', text: `${where(s.inning, s.half)}: the score was raised by hand (${plural(s.runs, 'run')} for ${name(s.side)}). No play scored ${s.runs === 1 ? 'it' : 'them'}, so nobody is credited.` });
    else if (s.kind === 'run') out.push({ level: 'fix', code: 'manual-run', text: `${where(s.inning, s.half)}: a run for ${name(s.side)} was added with Run scored, so no runner gets credit for it.` });
  }
  if (facts.source !== 'pad') return out;

  const stats = input.stats ?? [];
  const byEvent = new Map<number, SummaryStat[]>();
  for (const s of stats) byEvent.set(s.event_id, [...(byEvent.get(s.event_id) ?? []), s]);
  const lineups = input.lineups ?? {};
  // A side is checked only when its lineup was filled in. No lineup for us at
  // all is one note, not a fix per at-bat that nobody can make.
  const watch = (s: Side) => known(lineups[s]);
  if (!known(lineups.us)) out.push({ level: 'note', code: 'no-lineup', text: `There was no lineup for ${name('us')}, so these at-bats and pitches count for nobody.` });

  const noBatter: Record<Side, number> = { us: 0, them: 0 };
  const noPitcher: Record<Side, number> = { us: 0, them: 0 };
  const lostRunners: string[] = [];
  const hits: Record<Side, number> = { us: 0, them: 0 };
  const errors: Record<Side, number> = { us: 0, them: 0 };
  const moved: string[] = [];

  input.events.forEach((e, i) => {
    const { inning, half, kind, pa } = readEvent(e);
    const bat: Side = half === 'top' ? away : home;
    const field: Side = bat === 'us' ? 'them' : 'us';
    const rows = byEvent.get(e.id) ?? [];
    const batterUnknown = pa && !rows.some((r) => r.side === bat && r.b_pa);
    if (pa) {
      if (batterUnknown) noBatter[bat] += 1;
      if (!rows.some((r) => r.side === field && (num(r.p_bf) || num(r.p_outs) || num(r.p_pitches)))) noPitcher[field] += 1;
    }
    if (HITS.has(kind) && pa) hits[bat] += 1;
    // An error on a ball in play, an advance on an error, or one added by hand.
    if (kind === 'E' || kind === 'EA' || e.type === 'error') errors[field] += 1;
    if (e.type === 'batter' || e.type === 'batidx') moved.push(where(inning, half));

    // Runs on a real play with fewer runners credited than crossed the plate.
    // A play by an unknown batter is already counted above.
    if (e.type !== 'run' && !e.type.startsWith('adj') && !batterUnknown) {
      const after = (i + 1 < input.events.length ? input.events[i + 1].prev_live : live) ?? {};
      const key = bat === home ? 'home_score' : 'away_score';
      const runs = num(after[key]) - num((e.prev_live ?? {})[key]);
      const credited = rows.filter((r) => r.side === bat && r.b_r).reduce((a, r) => a + num(r.b_r), 0);
      if (runs > credited && watch(bat)) lostRunners.push(`${where(inning, half)} (${runs - credited} of ${runs})`);
    }
  });

  for (const s of ['us', 'them'] as Side[]) {
    if (!watch(s)) continue;
    if (noBatter[s]) out.push({ level: s === 'us' ? 'fix' : 'note', code: 'no-batter', text: `${plural(noBatter[s], 'time')} up for ${name(s)} with an empty lineup spot. Those at-bats count for nobody.` });
  }
  for (const s of ['us', 'them'] as Side[]) {
    if (!watch(s)) continue;
    if (noPitcher[s]) out.push({ level: s === 'us' ? 'fix' : 'note', code: 'no-pitcher', text: `${plural(noPitcher[s], 'batter')} faced ${name(s)} with no pitcher set. Those go on nobody's pitching line.` });
  }
  if (lostRunners.length) out.push({ level: 'fix', code: 'lost-runner', text: `Runs with no runner credited: ${lostRunners.join(', ')}. The runner on base was not known, so no one gets the R.` });

  // Pitchers who faced batters with no pitches counted, when that side counts pitches.
  for (const s of ['us', 'them'] as Side[]) {
    const lines = new Map<string, { bf: number; pitches: number }>();
    for (const r of stats.filter((x) => x.side === s)) {
      const l = lines.get(r.bid) ?? { bf: 0, pitches: 0 };
      l.bf += num(r.p_bf); l.pitches += num(r.p_pitches);
      lines.set(r.bid, l);
    }
    const counted = [...lines.values()].some((l) => l.pitches > 0);
    const none = [...lines.entries()].filter(([, l]) => l.bf > 0 && l.pitches === 0);
    if (counted && none.length && watch(s)) out.push({ level: 'note', code: 'no-pitches', text: `${plural(none.length, 'pitcher')} for ${name(s)} faced batters with no pitches counted.` });
  }

  // The scoreboard's hits and errors against the plays.
  for (const s of ['us', 'them'] as Side[]) {
    const shown = { h: num(live[s === home ? 'home_hits' : 'away_hits']), e: num(live[s === home ? 'home_errors' : 'away_errors']) };
    if (shown.h !== hits[s]) out.push({ level: 'note', code: 'hits', text: `The scoreboard shows ${plural(shown.h, 'hit')} for ${name(s)}; the plays have ${hits[s]}. The total was changed by hand.` });
    if (shown.e !== errors[s]) out.push({ level: 'note', code: 'errors', text: `The scoreboard shows ${plural(shown.e, 'error')} for ${name(s)}; the plays have ${errors[s]}. The total was changed by hand.` });
  }
  if (moved.length) out.push({ level: 'note', code: 'order-moved', text: `The batting order was moved by hand: ${[...new Set(moved)].join(', ')}. Check the right batters got those at-bats.` });

  // How it ended.
  const story = L.finalStory({ ...live, sport: game.sport ?? 'baseball', regulation_innings: input.regulationInnings ?? 0, run_rule_diff: input.runRule ?? 0 }) as { walkoff: boolean; runRule: boolean };
  const outs = num(live.outs), inning = num(live.inning) || 1, half = live.half === 'bottom' ? 'bottom' : 'top';
  if (outs > 0 && outs < 3 && !story.walkoff) {
    out.push({ level: 'note', code: 'mid-inning', text: `It ends with ${plural(outs, 'out')} in the ${where(inning, half).toLowerCase()}. Fine if the game was called or time ran out.` });
  }
  const reg = input.regulationInnings ?? 0;
  const played = facts.inningsPlayed;
  if (reg && played < reg && !story.runRule && !story.walkoff) {
    out.push({ level: 'note', code: 'short', text: `It ends after ${played} of ${reg} innings. Fine if time ran out or the game was called.` });
  }
  return out;
}
