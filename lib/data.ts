import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { createClient, supabaseConfigured } from './supabase/server';
import type { SeasonLine } from './stats';
import type { Invite, Player, Role, Season, StaffMember, Team } from './types';

const TEAM_COLS = 'id, slug, name, abbr, color, logo_url, age_group';
const PLAYER_COLS = 'id, team_id, first_name, last_name, number, bats, throws, positions, public_name, active';
const SEASON_COLS = 'id, team_id, name, starts_on, ends_on, is_current, game_innings';

// Only ever a path on this site: "/t/steel", never "//evil.example" or a URL.
export function safeNext(next: string | null | undefined, fallback = '/t') {
  return next && /^\/(?!\/)[^\\]*$/.test(next) ? next : fallback;
}

// Who is signed in, verified against the project's signing keys. Cached for
// the request, so a layout and its page ask once.
export const getUserId = cache(async (): Promise<string | null> => {
  if (!supabaseConfigured) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

export async function requireUserId(next: string) {
  const id = await getUserId();
  if (!id) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return id;
}

// The staff side of a team: the team, and the caller's seat on it. A signed-in
// user with no seat gets a 404 rather than a look around.
export const loadTeam = cache(async (slug: string) => {
  const userId = await requireUserId(`/t/${slug}`);
  const supabase = await createClient();
  const { data: team } = await supabase.from('teams').select(TEAM_COLS).eq('slug', slug).maybeSingle<Team>();
  if (!team) notFound();
  const { data: seat } = await supabase.from('team_staff').select('role')
    .eq('team_id', team.id).eq('user_id', userId).maybeSingle<{ role: Role }>();
  if (!seat) notFound();
  return { supabase, userId, team, role: seat.role };
});

export async function myTeams() {
  const userId = await getUserId();
  if (!userId) return [];
  const supabase = await createClient();
  const { data } = await supabase.from('team_staff')
    .select(`role, teams(${TEAM_COLS})`).eq('user_id', userId).order('created_at');
  return ((data ?? []) as unknown as { role: Role; teams: Team }[]).map((r) => ({ role: r.role, team: r.teams }));
}

type Db = Awaited<ReturnType<typeof createClient>>;

export async function listPlayers(db: Db, teamId: string) {
  const { data } = await db.from('players').select(PLAYER_COLS).eq('team_id', teamId);
  return (data ?? []) as Player[];
}
export async function getPlayer(db: Db, teamId: string, id: string) {
  const { data } = await db.from('players').select(PLAYER_COLS).eq('team_id', teamId).eq('id', id).maybeSingle<Player>();
  return data;
}
export async function listSeasons(db: Db, teamId: string) {
  const { data } = await db.from('seasons').select(SEASON_COLS).eq('team_id', teamId).order('created_at', { ascending: false });
  return (data ?? []) as Season[];
}
export async function listStaff(db: Db, teamId: string) {
  const { data } = await db.from('team_staff')
    .select('user_id, role, profiles(display_name)').eq('team_id', teamId).order('created_at');
  return ((data ?? []) as unknown as { user_id: string; role: Role; profiles: { display_name: string } | null }[])
    .map((r): StaffMember => ({ user_id: r.user_id, role: r.role, display_name: r.profiles?.display_name ?? 'Staff' }));
}
// Open links only: unused and not yet expired. Organizers see rows; for anyone
// else the policy returns none.
export async function listInvites(db: Db, teamId: string) {
  const { data } = await db.from('staff_invites').select('token, role, expires_at')
    .eq('team_id', teamId).is('used_at', null).gt('expires_at', new Date().toISOString()).order('created_at');
  return (data ?? []) as Invite[];
}

// Season lines, every source added up (the season_stats view). By season for
// a team's tables, by player for a player's card.
export async function seasonStats(db: Db, teamId: string, seasonId: string) {
  const { data } = await db.from('season_stats').select('*').eq('team_id', teamId).eq('season_id', seasonId);
  return (data ?? []) as SeasonLine[];
}
export async function playerStats(db: Db, playerId: string) {
  const { data } = await db.from('season_stats').select('*').eq('player_id', playerId);
  return (data ?? []) as SeasonLine[];
}
