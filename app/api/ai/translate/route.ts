// POST /api/ai/translate { gameId }: the game's recap in Spanish, from the
// English as it stands now, saved beside it.
import { NextResponse } from 'next/server';
import { aiWrite, fail, seat } from '@/lib/ai-call';
import { RecapContent } from '@/lib/recap';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import { checkTranslation, TRANSLATE_MODEL, TRANSLATE_SYSTEM, translatePrompt } from '@/lib/translate';

export const maxDuration = 90;

export async function POST(req: Request) {
  if (!supabaseConfigured) return fail(503, 'The database is not set up.');
  const { gameId } = (await req.json().catch(() => ({}))) as { gameId?: string };
  if (!gameId || !/^[0-9a-f-]{36}$/i.test(gameId)) return fail(400, 'Which game?');
  const db = await createClient();
  const { data: row } = await db.from('game_recaps').select('team_id, content, generated_at, edited_at').eq('game_id', gameId)
    .maybeSingle<{ team_id: string; content: unknown; generated_at: string; edited_at: string | null }>();
  if (!row) return fail(404, 'Write the recap first.');
  const who = await seat(db, row.team_id, ['organizer', 'head_coach', 'coach']);
  if ('error' in who) return who.error;
  const en = RecapContent.safeParse(row.content);
  if (!en.success) return fail(409, 'The recap could not be read. Write it again.');

  const r = await aiWrite({
    db, teamId: row.team_id, gameId, kind: 'translate', model: TRANSLATE_MODEL, system: TRANSLATE_SYSTEM, schema: RecapContent,
    effort: 'low', maxTokens: 16000, content: translatePrompt(en.data), check: (es) => checkTranslation(en.data, es),
  });
  if ('error' in r) return r.error;
  // Only onto the English it was written from: an edit or a new recap in the
  // meantime wins, and this Spanish is dropped.
  let q = db.from('game_recaps').update({ content_es: r.out }).eq('game_id', gameId).eq('generated_at', row.generated_at);
  q = row.edited_at ? q.eq('edited_at', row.edited_at) : q.is('edited_at', null);
  const { data: saved, error } = await q.select('game_id');
  if (error) return fail(500, `Could not save the Spanish: ${error.message}`);
  if (!saved?.length) return fail(409, 'The English changed while this was being written. Write the Spanish again.');
  return NextResponse.json({ content: r.out, warnings: r.warnings });
}
