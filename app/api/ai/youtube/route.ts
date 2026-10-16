// POST /api/ai/youtube { gameId }: a final game's YouTube title, intro and
// hashtags (Claude), with the half-inning and scoring-play marks and when the
// stream went live (both from the app). The game page builds the description
// and chapters from these, and lets the coach shift them if the times are off.
import { NextResponse } from 'next/server';
import { aiWrite, fail, seat } from '@/lib/ai-call';
import { clipMarks } from '@/lib/clips';
import { gameDate, getGameRow, loadClips, loadFacts, streamStartFor } from '@/lib/game-facts';
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
  const streamStart = marks.first ? await streamStartFor(db, game.team_id, marks.first) : null;
  // Saved clips are the highlights; runs are already listed as scoring plays.
  const highlights = clipMarks(await loadClips(db, game.id));

  const known = knownScores(facts);
  const r = await aiWrite({
    db, teamId: game.team_id, gameId: game.id, kind: 'youtube', model: YOUTUBE_MODEL, system: YOUTUBE_SYSTEM, schema: YoutubeText,
    effort: 'low', maxTokens: 4000, content: youtubePrompt(facts, gameDate(game.starts_at)),
    check: (t) => checkYoutube(t, known, scoreProblems),
  });
  if ('error' in r) return r.error;
  return NextResponse.json({ text: r.out, warnings: r.warnings, facts, halves: marks.halves, scoring: marks.scoring, first: marks.first, streamStart, highlights });
}
