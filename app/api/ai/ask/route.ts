// POST /api/ai/ask { teamId, seasonId, question }: a coach's question about
// the team's stats, answered from the season's own numbers. Staff only.
import { NextResponse } from 'next/server';
import { aiWrite, fail, seat } from '@/lib/ai-call';
import { ASK_MODEL, ASK_SYSTEM, AskAnswer, askPrompt, checkAsk, statsContext, type GameRow, type GameStatRow } from '@/lib/ask';
import { listPlayers, seasonStats } from '@/lib/data';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  if (!supabaseConfigured) return fail(503, 'The database is not set up.');
  const body = (await req.json().catch(() => ({}))) as { teamId?: string; seasonId?: string; question?: string };
  const question = (body.question ?? '').trim();
  if (!body.teamId || !UUID.test(body.teamId) || !body.seasonId || !UUID.test(body.seasonId)) return fail(400, 'Which team and season?');
  if (question.length < 4 || question.length > 300) return fail(400, 'Ask a question of up to 300 characters.');
  const db = await createClient();
  const who = await seat(db, body.teamId, ['organizer', 'head_coach', 'coach']);
  if ('error' in who) return who.error;

  const { data: season } = await db.from('seasons').select('id, name, game_innings').eq('id', body.seasonId).eq('team_id', body.teamId).maybeSingle<{ id: string; name: string; game_innings: number }>();
  if (!season) return fail(404, 'No such season.');
  const [players, lines, { data: games }] = await Promise.all([
    listPlayers(db, body.teamId), seasonStats(db, body.teamId, season.id),
    db.from('games').select('id, starts_at, opponent_name, is_home, status, live, counts_for_stats').eq('team_id', body.teamId).eq('season_id', season.id),
  ]);
  const ids = (games ?? []).map((g) => g.id);
  const { data: gameLines } = ids.length
    ? await db.from('game_stats').select('game_id, player_id, b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_sb, p_outs, p_so, p_r, p_er, p_bb, p_h, p_pitches').in('game_id', ids).eq('side', 'us')
    : { data: [] };
  const context = statsContext({ season: season.name, gameInnings: season.game_innings, players, lines, games: (games ?? []) as GameRow[], gameLines: (gameLines ?? []) as GameStatRow[] });

  const r = await aiWrite({
    db, teamId: body.teamId, kind: 'ask', model: ASK_MODEL, system: ASK_SYSTEM, schema: AskAnswer,
    effort: 'medium', maxTokens: 6000, content: askPrompt(context, question), check: checkAsk,
  });
  if ('error' in r) return r.error;
  return NextResponse.json(r.out);
}
