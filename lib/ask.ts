// "Ask your stats": a coach's question answered from the team's own numbers.
// Claude gets the season's lines (with the rates worked out here, so it never
// does the arithmetic), the games and their results, and each pad-scored
// game's lines, and answers only from them. Staff only; players are named in
// the team's chosen format, so a team that keeps first names sends no more.
import { z } from 'zod';
import { batting, innings, pitching, rate2, rate3, type SeasonLine } from './stats.ts';
import { formatName } from './format.ts';
import type { NameFormat, Player } from './types.ts';

export const ASK_MODEL = 'claude-sonnet-5-5';

export const AskAnswer = z.object({
  answer: z.string().describe('A short answer in plain sentences, at most about 120 words.'),
  columns: z.array(z.string()).describe('Column headings for a small table backing the answer, or empty for none.'),
  rows: z.array(z.array(z.string())).describe('Table rows, each as many cells as columns; at most 15 rows.'),
  basis: z.string().describe('One line on which numbers the answer used, e.g. "season totals, 11 games".'),
});
export type AskAnswer = z.infer<typeof AskAnswer>;

export const ASK_SYSTEM = `You answer a youth baseball coach's questions about their own team's stats. The data is JSON: the season's lines for each player (rates already worked out), the games with results, and per-game lines for the games scored in the app.
- Answer only from the data. If it cannot answer the question (a stat not tracked, a game not scored in the app), say so plainly and say what it can answer instead.
- Use the rates as given; do not recompute them. Mention sample size when it is small (fewer than 10 plate appearances or 3 innings).
- Season totals may include games imported from GameChanger that have no per-game lines; per-game questions can only use the games listed with lines.
- Be encouraging and useful to a coach: these are kids. No judgements of character.
- Keep it short. Add a small table only when it helps (a ranking, a comparison).`;

const nz = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v));

export type GameRow = { id: string; starts_at: string | null; opponent_name: string; is_home: boolean; status: string; live: { home_score?: number; away_score?: number } | null; counts_for_stats: boolean };
export type GameStatRow = { game_id: string; player_id: string | null; b_pa: number; b_ab: number; b_h: number; b_2b: number; b_3b: number; b_hr: number; b_rbi: number; b_r: number; b_bb: number; b_so: number; b_sb: number; p_outs: number; p_so: number; p_r: number; p_er: number; p_bb: number; p_h: number; p_pitches: number };

// Players as the staff screens show them: the team's name format, with the number.
export function statsContext(o: { season: string; gameInnings: number; players: Player[]; lines: SeasonLine[]; games: GameRow[]; gameLines: GameStatRow[]; fmt?: NameFormat }) {
  const who = new Map(o.players.map((p) => [p.id, `${formatName(p, o.fmt ?? 'full') || 'Player'}${p.number ? ` #${p.number}` : ''}`]));
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : null);
  const games = o.games.filter((g) => g.status === 'final').map((g) => {
    const us = Number(g.is_home ? g.live?.home_score : g.live?.away_score) || 0;
    const them = Number(g.is_home ? g.live?.away_score : g.live?.home_score) || 0;
    return { id: g.id, date: day(g.starts_at), opponent: g.opponent_name, result: us > them ? 'W' : us < them ? 'L' : 'T', score: `${us}-${them}`, counts: g.counts_for_stats };
  }).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const byGame = new Map<string, Record<string, Record<string, number>>>();
  for (const r of o.gameLines) {
    if (!r.player_id) continue;
    const g = byGame.get(r.game_id) ?? {};
    const k = who.get(r.player_id) ?? 'unknown';
    const cur = g[k] ?? {};
    for (const [f, v] of Object.entries(r)) if (typeof v === 'number') cur[f] = (cur[f] ?? 0) + v;
    g[k] = cur; byGame.set(r.game_id, g);
  }
  return {
    season: o.season,
    players: o.lines.filter((l) => who.has(l.player_id)).map((l) => {
      const b = batting(l), p = pitching(l, o.gameInnings);
      return {
        player: who.get(l.player_id),
        batting: l.b_pa ? { ...nz({ G: l.b_g, PA: l.b_pa, AB: l.b_ab, H: l.b_h, '2B': l.b_2b, '3B': l.b_3b, HR: l.b_hr, R: l.b_r, RBI: l.b_rbi, BB: l.b_bb, SO: l.b_so, HBP: l.b_hbp, SB: l.b_sb, CS: l.b_cs }),
          AVG: rate3(b.avg), OBP: rate3(b.obp), SLG: rate3(b.slg), OPS: rate3(b.ops) } : null,
        pitching: l.p_outs || l.p_bf ? { IP: innings(l.p_outs), ...nz({ G: l.p_g, GS: l.p_gs, BF: l.p_bf, H: l.p_h, R: l.p_r, ER: l.p_er, BB: l.p_bb, SO: l.p_so, W: l.p_w, L: l.p_l, SV: l.p_sv, P: l.p_pitches }),
          ERA: rate2(p.era), WHIP: rate2(p.whip) } : null,
      };
    }),
    games: games.map((g) => ({ ...g, lines: byGame.has(g.id) ? Object.fromEntries(Object.entries(byGame.get(g.id)!).map(([k, v]) => [k, nz({
      PA: v.b_pa, AB: v.b_ab, H: v.b_h, '2B': v.b_2b, '3B': v.b_3b, HR: v.b_hr, R: v.b_r, RBI: v.b_rbi, BB: v.b_bb, SO: v.b_so, SB: v.b_sb,
      IPouts: v.p_outs, pSO: v.p_so, pR: v.p_r, pER: v.p_er, pBB: v.p_bb, pH: v.p_h, P: v.p_pitches })])) : null })).map(({ id: _id, ...g }) => { void _id; return g; }),
  };
}

export const askPrompt = (context: ReturnType<typeof statsContext>, question: string) =>
  `<data>\n${JSON.stringify(context)}\n</data>\n\nQuestion: ${question}`;

export function checkAsk(a: AskAnswer): string[] {
  const out: string[] = [];
  if (!a.answer.trim()) out.push('The answer was empty.');
  if (a.columns.length && a.rows.some((r) => r.length !== a.columns.length)) out.push('Every table row needs one cell per column.');
  if (a.rows.length > 15) out.push('Keep the table to 15 rows.');
  return out;
}
