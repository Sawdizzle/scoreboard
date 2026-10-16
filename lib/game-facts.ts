// A final game as the AI helpers see it: the game row, its public view (names
// under each player's public-name setting), its play log and stat rows, and
// the facts worked out from them. Server only, run as the signed-in user.
import type { GameSettings } from './broadcast';
import type { ClipRow } from './clips';
import type { PublicGame } from './public';
import { summarizeGame, type GameFacts, type SummaryEvent, type SummaryStat } from './summarize';
import type { createClient } from './supabase/server';

type Db = Awaited<ReturnType<typeof createClient>>;
export type GameRow = { id: string; team_id: string; sport: string; status: string; is_home: boolean; live: Record<string, unknown>; settings: GameSettings | null; starts_at: string | null; venue: string | null };
export const STAT_COLS = 'event_id, side, bid, b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_hbp, b_sb, p_outs, p_bf, p_h, p_r, p_er, p_bb, p_so, p_pitches';

export async function getGameRow(db: Db, gameId: string) {
  const { data } = await db.from('games').select('id, team_id, sport, status, is_home, live, settings, starts_at, venue').eq('id', gameId).maybeSingle<GameRow>();
  return data;
}

export async function loadFacts(db: Db, game: GameRow): Promise<{ facts: GameFacts; pub: PublicGame; events: SummaryEvent[] } | null> {
  const [{ data: pub }, { data: events }, { data: stats }] = await Promise.all([
    db.rpc('public_game', { p_game: game.id }),
    db.from('game_events').select('id, seq, type, payload, prev_live, created_at').eq('game_id', game.id).order('seq'),
    db.from('game_stats').select(STAT_COLS).eq('game_id', game.id),
  ]);
  const p = pub as PublicGame | null;
  if (!p) return null;
  const ev = (events ?? []) as SummaryEvent[];
  const facts = summarizeGame({
    game: { is_home: game.is_home, status: game.status, live: game.live, sport: game.sport },
    teams: { us: p.team.display_name || p.team.name, them: p.opponent.display_name || p.opponent.name },
    events: ev, stats: (stats ?? []) as SummaryStat[],
    lineups: p.lineups,
    regulationInnings: game.settings?.regulation ?? p.season?.game_innings ?? null,
    runRule: game.settings?.run_rule ?? null,
  });
  return { facts, pub: p, events: ev };
}

// "Saturday, October 17, 2026", in the team's time zone.
// When the stream that carried a moment went live: the last start before it,
// still open or closed after it, and begun within 12 hours of it, so a
// session left open by a crash is never mistaken for this game's.
export async function streamStartFor(db: Db, teamId: string, at: string): Promise<string | null> {
  const { data } = await db.from('stream_sessions').select('started_at, ended_at').eq('team_id', teamId)
    .lte('started_at', at).order('started_at', { ascending: false }).limit(1).maybeSingle<{ started_at: string; ended_at: string | null }>();
  const near = data && Date.parse(at) - Date.parse(data.started_at) < 12 * 3600000;
  return data && near && (!data.ended_at || data.ended_at >= at) ? data.started_at : null;
}

// A game's replay-buffer saves (game_clips), oldest first.
export const CLIP_COLS = 'id, n, kind, kinds, source, seq, inning, half, away_score, home_score, moment_at, status, code';
export async function loadClips(db: Db, gameId: string) {
  const { data } = await db.from('game_clips').select(CLIP_COLS).eq('game_id', gameId).order('moment_at');
  return (data ?? []) as ClipRow[];
}

export const gameDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : null);
