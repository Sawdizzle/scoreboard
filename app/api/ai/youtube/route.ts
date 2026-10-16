// POST /api/ai/youtube { gameId }: a final game's YouTube title, intro and
// hashtags (Claude), with the half-inning and scoring-play marks and when the
// stream went live (both from the app). The game page builds the description
// and chapters from these, and lets the coach shift them if the times are off.
import { NextResponse } from 'next/server';
import { aiWrite, fail, seat } from '@/lib/ai-call';
import { gameDate, getGameRow, loadFacts } from '@/lib/game-facts';
import { knownScores, scoreProblems } from '@/lib/recap';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import { checkYoutube, videoMarks, YOUTUBE_MODEL, YOUTUBE_SYSTEM, youtubePrompt, YoutubeText } from '@/lib/youtube';

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!supabaseConfigured) return fail(503, 'The database is not set up.');
  const { gameId } = (await req.json().catch(() => ({}))) as { gameId?: string };
  if (!gameId || !/^[0-9a-f-]{36}$/i.test(gameId)) return fail(400, 'Which game?');
  const db = await createClient();
  const game = await getGameRow(db, gameId);
  if (!game) return fail(404, 'No such game.');
  const who = await seat(db, game.team_id, ['organizer', 'head_coach', 'coach']);
  if ('error' in who) return who.error;
  if (game.status !== 'final') return fail(409, 'End the game first.');
  const loaded = await loadFacts(db, game);
  if (!loaded) return fail(404, 'No such game.');
  const { facts, events } = loaded;
  const marks = videoMarks(events, facts);

  // The stream session the game was played in: the last start before first pitch.
  let streamStart: string | null = null;
  if (marks.first) {
    const { data } = await db.from('stream_sessions').select('started_at, ended_at').eq('team_id', game.team_id)
      .lte('started_at', marks.first).order('started_at', { ascending: false }).limit(1).maybeSingle<{ started_at: string; ended_at: string | null }>();
    if (data && (!data.ended_at || data.ended_at >= marks.first)) streamStart = data.started_at;
  }

  const known = knownScores(facts);
  const r = await aiWrite({
    db, teamId: game.team_id, gameId: game.id, kind: 'youtube', model: YOUTUBE_MODEL, system: YOUTUBE_SYSTEM, schema: YoutubeText,
    effort: 'low', maxTokens: 4000, content: youtubePrompt(facts, gameDate(game.starts_at)),
    check: (t) => checkYoutube(t, known, scoreProblems),
  });
  if ('error' in r) return r.error;
  return NextResponse.json({ text: r.out, warnings: r.warnings, facts, halves: marks.halves, scoring: marks.scoring, first: marks.first, streamStart });
}
