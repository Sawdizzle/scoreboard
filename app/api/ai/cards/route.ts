// POST /api/ai/cards { teamId, seasonId }: end-of-season cards for every
// player, from the season's numbers, named as the public may see them.
import { NextResponse } from 'next/server';
import { aiWrite, fail, seat } from '@/lib/ai-call';
import { CARDS_MODEL, CARDS_SYSTEM, Cards, cardData, cardsPrompt, checkCards } from '@/lib/cards';
import { listPlayers, seasonStats } from '@/lib/data';
import { createClient, supabaseConfigured } from '@/lib/supabase/server';
import type { NameFormat } from '@/lib/types';

export const maxDuration = 120;
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  if (!supabaseConfigured) return fail(503, 'The database is not set up.');
  const body = (await req.json().catch(() => ({}))) as { teamId?: string; seasonId?: string };
  if (!body.teamId || !UUID.test(body.teamId) || !body.seasonId || !UUID.test(body.seasonId)) return fail(400, 'Which team and season?');
  const db = await createClient();
  const who = await seat(db, body.teamId, ['organizer', 'head_coach', 'coach']);
  if ('error' in who) return who.error;
  const [{ data: team }, { data: season }, players, lines] = await Promise.all([
    db.from('teams').select('display_name, name_format, age_group').eq('id', body.teamId).single<{ display_name: string; name_format: NameFormat; age_group: string | null }>(),
    db.from('seasons').select('name, game_innings').eq('id', body.seasonId).eq('team_id', body.teamId).maybeSingle<{ name: string; game_innings: number }>(),
    listPlayers(db, body.teamId), seasonStats(db, body.teamId, body.seasonId),
  ]);
  if (!season || !team) return fail(404, 'No such season.');
  const data = cardData({ players, lines, fmt: team.name_format, gameInnings: season.game_innings });
  if (!data.length) return fail(409, 'No players with a season to write about.');
  if (data.length > 30) return fail(409, 'More than 30 players: cards are written for one roster at a time.');
  const r = await aiWrite({
    db, teamId: body.teamId, kind: 'card', model: CARDS_MODEL, system: CARDS_SYSTEM, schema: Cards,
    effort: 'medium', maxTokens: 16000, content: cardsPrompt(season.name, team.display_name, data),
    check: (c) => checkCards(c, data, [season.name, team.display_name, team.age_group ?? '']),
  });
  if ('error' in r) return r.error;
  const byKey = new Map(r.out.cards.map((c) => [c.key, c]));
  return NextResponse.json({ cards: data.map((p) => ({ name: p.name, ...(byKey.get(p.key) ?? { headline: '', body: '', highlights: [] }) })), warnings: r.warnings, season: season.name });
}
