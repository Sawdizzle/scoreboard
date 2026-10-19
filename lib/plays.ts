// The game's log, read back for people: how many pitches each pitcher threw
// in each inning, and the plays one by one with who was credited, so a
// scorer can fix a credit on an earlier play (GameChanger's Plays tab). Pure:
// the pad reads game_events and game_stats and hands them in.
import * as L from './rules/logic.js';
import type { Side } from './types.ts';

export type LogEvent = {
  id: number; seq: number; type: string;
  payload: { play?: { kind?: string; code?: string; inning?: number; half?: 'top' | 'bottom'; outs?: number; runs?: number }; field?: Record<string, string> } | null;
  prev_live: { inning?: number; half?: 'top' | 'bottom' } | null;
};
export type LogStat = {
  event_id: number; side: Side; bid: string;
  b_pa?: number; b_r?: number; b_sb?: number; b_cs?: number; b_pik?: number; b_rbi?: number;
  p_pitches?: number; p_bf?: number; p_outs?: number; f_po?: number; f_a?: number; f_e?: number; c_pik?: number;
};

// ---- Pitch counts -------------------------------------------------------------
// Every pitch is a stat row on the pitcher who threw it (p_pitches), on the
// event that was the pitch; the event's snapshot says which inning it was.
// Balls are the pitches that were called balls (a walk's fourth, a hit
// batter, catcher's interference); everything else thrown is a strike, fouls
// and balls in play included, the way pitch counts are kept. A pitch count
// fixed by hand on the Situation sheet is not a pitch, and is not here.
const BALLS = new Set(['ball', 'walk', 'hbp', 'ci']);
export type PitchLine = { side: Side; bid: string; total: number; strikes: number; innings: Record<number, number> };
export function pitchCounts(events: LogEvent[], stats: LogStat[]): PitchLine[] {
  const ev = new Map(events.map((e) => [e.id, e]));
  const out = new Map<string, PitchLine>();
  for (const s of [...stats].sort((a, b) => a.event_id - b.event_id)) {
    const n = Number(s.p_pitches) || 0;
    const e = ev.get(s.event_id);
    if (!n || !e) continue;
    const key = `${s.side}:${s.bid}`;
    const line = out.get(key) ?? { side: s.side, bid: s.bid, total: 0, strikes: 0, innings: {} };
    const inn = Number(e.prev_live?.inning) || 1;
    line.total += n;
    line.innings[inn] = (line.innings[inn] ?? 0) + n;
    if (!BALLS.has(e.type)) line.strikes += n;
    out.set(key, line);
  }
  return [...out.values()];
}

// ---- The plays ----------------------------------------------------------------
// Every event that left a note for the play-by-play: what it was, its code,
// and who got what out of it. Newest first.
export type PlayRow = {
  id: number; seq: number; inning: number; half: 'top' | 'bottom'; kind: string; code: string; text: string; outs: number; runs: number;
  batSide: Side; fieldSide: Side;
  // Who was credited: the batter (a plate appearance), the runners (a run, a
  // steal, caught or picked off), the pitcher, the fielders (putouts, assists, errors).
  batter: string | null; runners: string[]; pitcher: string | null; fielders: string[];
  // Who stood where, for re-crediting the fielders (absent on older plays).
  field: Record<string, string> | null;
};
const n = (v: number | undefined) => Number(v) || 0;
export function playList(events: LogEvent[], stats: LogStat[], battingSide: (half: 'top' | 'bottom') => Side): PlayRow[] {
  const by = new Map<number, LogStat[]>();
  for (const s of stats) by.set(s.event_id, [...(by.get(s.event_id) ?? []), s]);
  const rows: PlayRow[] = [];
  for (const e of events) {
    const note = e.payload?.play;
    if (!note?.kind) continue;
    const half = note.half ?? e.prev_live?.half ?? 'top';
    const batSide = battingSide(half), fieldSide: Side = batSide === 'us' ? 'them' : 'us';
    const mine = by.get(e.id) ?? [];
    const batter = mine.find((s) => s.side === batSide && n(s.b_pa) > 0)?.bid ?? null;
    const runners = mine.filter((s) => s.side === batSide && s.bid !== batter && (n(s.b_r) || n(s.b_sb) || n(s.b_cs) || n(s.b_pik))).map((s) => s.bid);
    const pitcher = mine.find((s) => s.side === fieldSide && (n(s.p_pitches) || n(s.p_bf) || n(s.p_outs)))?.bid ?? null;
    const fielders = mine.filter((s) => s.side === fieldSide && (n(s.f_po) || n(s.f_a) || n(s.f_e))).map((s) => s.bid);
    const label = (L.PLAY_LABEL as Record<string, string>)[note.kind] ?? note.kind;
    const code = note.code ?? '';
    const runs = n(note.runs);
    rows.push({
      id: e.id, seq: e.seq, inning: n(note.inning) || n(e.prev_live?.inning) || 1, half, kind: note.kind, code,
      text: `${label}${code && note.kind !== 'K3' ? ` ${code}` : ''}${runs ? ` · ${runs} run${runs > 1 ? 's' : ''}` : ''}`,
      outs: n(note.outs), runs, batSide, fieldSide, batter, runners, pitcher, fielders, field: e.payload?.field ?? null,
    });
  }
  return rows.sort((a, b) => b.seq - a.seq);
}

// Plays whose fielders can be re-credited: the ones the fielders' credit comes
// from a code for (lib/scoring fieldingCredit). A hit has no fielders to fix.
const FIELDED = new Set(['GB', 'FB', 'LD', 'PU', 'E', 'FC', 'DP', 'SF', 'SAC', 'K3', 'CS', 'PO', 'RO', 'EA', 'BO']);
export const canRefield = (kind: string) => FIELDED.has(kind);
