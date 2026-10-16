// POST /api/ai/lineup { gameId, side, image, mediaType }: read a batting order
// from a photo. Nothing is saved: the lines go into the lineup screen's paste
// box for the scorer to check, and Save works as it always has.
import { aiWrite, fail, seat } from '@/lib/ai-call';
import { LINEUP_MODEL, LINEUP_SYSTEM, LineupRead, checkLineup, lineupLines, lineupPrompt } from '@/lib/lineup-photo';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const maxDuration = 60;
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export async function POST(req: Request) {
  if (!supabaseConfigured) return fail(503, 'The database is not set up.');
  const body = (await req.json().catch(() => ({}))) as { gameId?: string; side?: string; image?: string; mediaType?: string };
  if (!body.gameId || !/^[0-9a-f-]{36}$/i.test(body.gameId)) return fail(400, 'Which game?');
  const side = body.side === 'them' ? 'them' : 'us';
  if (!body.image || !TYPES.has(body.mediaType ?? '') || body.image.length > 3_300_000) return fail(400, 'That photo is too large. Send one JPEG, PNG or WebP under 2 MB.');

  const db = await createClient();
  const { data: game } = await db.from('games').select('id, team_id, opponent_name').eq('id', body.gameId)
    .maybeSingle<{ id: string; team_id: string; opponent_name: string }>();
  if (!game) return fail(404, 'No such game.');
  const who = await seat(db, game.team_id, ['organizer', 'head_coach', 'coach', 'scorer']);
  if ('error' in who) return who.error;
  const { data: team } = await db.from('teams').select('display_name').eq('id', game.team_id).single<{ display_name: string }>();

  const r = await aiWrite({
    db, teamId: game.team_id, gameId: game.id, kind: 'lineup', model: LINEUP_MODEL, system: LINEUP_SYSTEM, schema: LineupRead,
    effort: 'medium', check: checkLineup,
    content: [
      { type: 'image', source: { type: 'base64', media_type: body.mediaType as 'image/jpeg', data: body.image } },
      { type: 'text', text: lineupPrompt(side, side === 'us' ? team?.display_name ?? 'our team' : game.opponent_name) },
    ],
  });
  if ('error' in r) return r.error;
  return NextResponse.json({ lines: lineupLines(r.out), unsure: [...r.out.unsure, ...r.warnings] });
}
