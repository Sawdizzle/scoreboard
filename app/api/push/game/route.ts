import { timingSafeEqual } from 'node:crypto';
import { notifyTeam } from '@/lib/push';
import { result } from '@/lib/public';
import { adminClient } from '@/lib/supabase/admin';
import type { Game } from '@/lib/types';

// Called by the database (games_notice, through pg_net) when a game goes live
// or final: tells everyone following the team. The shared secret is the only
// way in; the database has already made sure each moment is sent once.
export async function POST(req: Request) {
  const secret = process.env.PUSH_HOOK_SECRET?.trim() ?? '';
  const given = req.headers.get('x-push-secret') ?? '';
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response('Forbidden', { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { game_id?: string; status?: string } | null;
  const admin = adminClient();
  if (!admin || !body?.game_id || !/^[0-9a-f-]{36}$/i.test(body.game_id)) return new Response('Bad request', { status: 400 });
  const { data: g } = await admin.from('games').select('id, team_id, opponent_name, is_home, status, live, teams!games_team_id_fkey(slug, display_name, private)')
    .eq('id', body.game_id).maybeSingle();
  if (!g) return new Response('Not found', { status: 404 });
  const game = g as unknown as Pick<Game, 'id' | 'team_id' | 'opponent_name' | 'is_home' | 'status' | 'live'> & { teams: { slug: string; display_name: string; private: boolean } };
  if (game.status !== body.status) return Response.json({ sent: 0, stale: true });
  const name = game.teams.display_name, vs = `${game.is_home ? 'vs' : 'at'} ${game.opponent_name}`;
  // A private team's fans are none (it cannot be followed); its families still hear.
  const url = game.teams.private ? `/t/${game.teams.slug}` : `/team/${game.teams.slug}/game/${game.id}`;
  const msg = game.status === 'live'
    ? { title: `${name} ${vs} is on`, body: 'The game has started. Follow it live.', url, tag: `game-${game.id}` }
    : { title: `Final: ${name} ${vs}`, body: result(game) ?? 'The game is over.', url, tag: `game-${game.id}` };
  const sent = await notifyTeam(game.team_id, 'followers', 'games', msg);
  return Response.json({ sent });
}
