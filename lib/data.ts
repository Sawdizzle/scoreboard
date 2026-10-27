import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { createClient, supabaseConfigured } from './supabase/server';
import type { PadGame } from './gamechanger';
import { sprayBalls, type SprayEvent, type SprayStat } from './spray';
import type { SeasonLine } from './stats';
import { isStaff, type Channel, type Game, type Invite, type Lineup, type Member, type MemberRole, type Message, type Org, type Player, type Role, type Rsvp, type Season, type Seat, type Side, type StaffMember, type Team, type TeamEvent } from './types';

export const TEAM_COLS = 'id, slug, name, display_name, abbr, color, color2, palette, logo_url, age_group, name_format, private, org_id';
const PLAYER_COLS = 'id, team_id, first_name, last_name, number, bats, throws, positions, public_name, active';
const SEASON_COLS = 'id, team_id, name, starts_on, ends_on, is_current, game_innings';

export { safeNext } from './safe-next';

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

// The caller's place on a team: a staff seat, the team admin's seat an org
// admin holds on every team in their league, or a membership (parent, fan).
// Someone with none gets a 404 rather than a look around. A parent waiting for
// approval comes back with status 'pending' and nothing more.
export const loadMember = cache(async (slug: string) => {
  const userId = await requireUserId(`/t/${slug}`);
  const supabase = await createClient();
  const { data: team } = await supabase.from('teams').select(TEAM_COLS).eq('slug', slug).maybeSingle<Team>();
  if (!team) notFound();
  const [{ data: staff }, { data: member }] = await Promise.all([
    supabase.from('team_staff').select('role').eq('team_id', team.id).eq('user_id', userId).maybeSingle<{ role: Role }>(),
    supabase.from('team_members').select('role, status').eq('team_id', team.id).eq('user_id', userId)
      .maybeSingle<{ role: MemberRole; status: 'pending' | 'active' }>(),
  ]);
  let seat: Seat | null = staff?.role ?? null;
  if (!seat && team.org_id) {
    const { data: admin } = await supabase.rpc('is_org_admin_of_team', { p_team: team.id });
    if (admin) seat = 'organizer';
  }
  if (seat) return { supabase, userId, team, seat, status: 'active' as const };
  if (!member) notFound();
  return { supabase, userId, team, seat: member.role as Seat, status: member.status };
});

// The staff side of a team: the team, and the caller's seat on it. Parents and
// fans get the same 404 as a stranger.
export const loadTeam = cache(async (slug: string) => {
  const m = await loadMember(slug);
  if (!isStaff(m.seat)) notFound();
  return { supabase: m.supabase, userId: m.userId, team: m.team, role: m.seat };
});

// Every team the caller is on: seats first, then teams they follow or parent,
// then the teams of leagues they run.
export async function myTeams() {
  const userId = await getUserId();
  if (!userId) return [];
  const supabase = await createClient();
  const [{ data: seats }, { data: members }, { data: orgs }] = await Promise.all([
    supabase.from('team_staff').select(`role, teams(${TEAM_COLS})`).eq('user_id', userId).order('created_at'),
    supabase.from('team_members').select(`role, status, teams(${TEAM_COLS})`).eq('user_id', userId).order('created_at'),
    supabase.from('org_members').select('organizations(id, teams(id))').eq('user_id', userId),
  ]);
  const out = [
    ...((seats ?? []) as unknown as { role: Role; teams: Team }[]).map((r) => ({ seat: r.role as Seat, team: r.teams, pending: false })),
    ...((members ?? []) as unknown as { role: MemberRole; status: string; teams: Team }[])
      .map((r) => ({ seat: r.role as Seat, team: r.teams, pending: r.status === 'pending' })),
  ];
  const have = new Set(out.map((r) => r.team.id));
  const leagueTeams = ((orgs ?? []) as unknown as { organizations: { teams: { id: string }[] } | null }[])
    .flatMap((o) => o.organizations?.teams ?? []).map((x) => x.id).filter((id) => !have.has(id));
  if (leagueTeams.length) {
    const { data } = await supabase.from('teams').select(TEAM_COLS).in('id', leagueTeams).order('name');
    for (const team of (data ?? []) as Team[]) out.push({ seat: 'organizer', team, pending: false });
  }
  return out;
}

export async function myOrgs() {
  const userId = await getUserId();
  if (!userId) return [];
  const supabase = await createClient();
  const { data } = await supabase.from('org_members').select('organizations(id, slug, name, color, logo_url)').eq('user_id', userId);
  return ((data ?? []) as unknown as { organizations: Org | null }[]).flatMap((r) => (r.organizations ? [r.organizations] : []));
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
// A player's balls in play in the games the pad scored that count, every
// season, for the spray chart on the card (lib/spray). Read newest first, so a
// read cut short at the row cap loses the oldest. Staff only, as the log is:
// for anyone else the policy hides every play, and with it every row here.
export async function playerSpray(db: Db, playerId: string) {
  const { data } = await db.from('game_stats')
    .select('event_id, side, bid, b_pa, game_events!inner(id, type, payload), games!inner(season_id)')
    .eq('player_id', playerId).eq('side', 'us').gt('b_pa', 0)
    .eq('games.counts_for_stats', true).not('games.season_id', 'is', null)
    .order('event_id', { ascending: false });
  const rows = (data ?? []) as unknown as (SprayStat & { game_events: Omit<SprayEvent, 'season_id'>; games: { season_id: string } })[];
  return sprayBalls(rows.map((r) => ({ ...r.game_events, season_id: r.games.season_id })), rows, playerId);
}

const GAME_COLS = `id, sport, team_id, season_id, counts_for_stats, opponent_team_id, opponent_name, opponent_abbr, opponent_color, is_home, starts_at, venue, address, tournament_url, status, live, clock, settings, venue_geo, opponent_id, opponent:teams!games_opponent_team_id_fkey(${TEAM_COLS}), saved:opponents!games_opponent_id_fkey(name, abbr, color, color2, logo_url)`;
// The same, for a signed-out visitor: anon may not read where a game is.
const PUBLIC_GAME_COLS = GAME_COLS.replace('address, ', '').replace('venue_geo, ', '');

// A tournament weekend: the next game is usually at the same field, in the same
// tournament, so a new game starts with the place of a game within three days.
export async function recentPlace(db: Db, teamId: string) {
  const near = (ms: number) => new Date(Date.now() + ms).toISOString();
  const { data } = await db.from('games').select('venue, address, tournament_url')
    .eq('team_id', teamId).gte('starts_at', near(-3 * 864e5)).lte('starts_at', near(3 * 864e5))
    .or('address.not.is.null,tournament_url.not.is.null').order('starts_at', { ascending: false }).limit(1)
    .maybeSingle<Pick<Game, 'venue' | 'address' | 'tournament_url'>>();
  return data;
}

// A team's games, soonest first; games with no time yet sort last. The public
// page asks without the address and coordinates, which anon cannot read.
export async function listGames(db: Db, teamId: string, seasonId?: string, opts: { public?: boolean } = {}) {
  let q = db.from('games').select(opts.public ? PUBLIC_GAME_COLS : GAME_COLS).eq('team_id', teamId);
  if (seasonId) q = q.eq('season_id', seasonId);
  const { data } = await q.order('starts_at', { ascending: true, nullsFirst: false });
  const rows = (data ?? []) as unknown as Game[];
  return opts.public ? rows.map((g) => ({ ...g, address: null, venue_geo: null })) : rows;
}
// Games the pad has scored for us that count for stats, by season if given:
// season stats already hold them, so their season takes no GameChanger import.
// One game_stats row per game is enough to know. A failed read throws, so
// the import is never let through on a guess.
export async function padScoredGames(db: Db, teamId: string, seasonId?: string) {
  let q = db.from('games').select('id, season_id, opponent_name, is_home, starts_at, game_stats!inner(id)')
    .eq('team_id', teamId).eq('counts_for_stats', true).not('season_id', 'is', null)
    .eq('game_stats.side', 'us').limit(1, { referencedTable: 'game_stats' });
  if (seasonId) q = q.eq('season_id', seasonId);
  const { data, error } = await q.order('starts_at', { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(({ id, season_id, opponent_name, is_home, starts_at }) =>
    ({ id, season_id, opponent_name, is_home, starts_at })) as PadGame[];
}
export async function getGame(db: Db, teamId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.from('games').select(GAME_COLS).eq('team_id', teamId).eq('id', id).maybeSingle<Game>();
  return data;
}
export async function getLineups(db: Db, gameId: string) {
  const { data } = await db.from('game_lineups').select('side, data').eq('game_id', gameId);
  const out: Partial<Record<Side, Lineup>> = {};
  for (const r of (data ?? []) as { side: Side; data: Lineup }[]) out[r.side] = r.data;
  return out;
}
// Our lineup from the most recent other game that has one, for "Same as last
// game": one before this game, never a later one whose lineup was set first.
export async function lastLineup(db: Db, teamId: string, exceptGame: string, before?: string | null) {
  let q = db.from('games').select('id, starts_at, game_lineups!inner(side, data)')
    .eq('team_id', teamId).neq('id', exceptGame).eq('game_lineups.side', 'us');
  if (before) q = q.lt('starts_at', before);
  const { data } = await q.order('starts_at', { ascending: false, nullsFirst: false }).limit(1);
  const row = (data ?? [])[0] as { game_lineups: { data: Lineup }[] } | undefined;
  return row?.game_lineups?.[0]?.data ?? null;
}
// Another team's roster as the public sees it: names under each player's own
// public-name setting.
export async function publicRoster(db: Db, teamId: string) {
  const { data } = await db.rpc('public_roster', { p_team: teamId });
  return (data ?? []) as { id: string; number: string; display_name: string | null; positions: string[] }[];
}
// Teams on Scoreboard whose name matches, for picking an opponent.
export async function findTeams(db: Db, q: string, notTeam: string) {
  const term = q.replace(/[%_,()]/g, ' ').trim();
  if (term.length < 2) return [];
  const { data } = await db.from('teams').select(TEAM_COLS).ilike('name', `%${term}%`).neq('id', notTeam).order('name').limit(8);
  return (data ?? []) as Team[];
}

// Opponents this team has played that are not teams on Scoreboard, most
// recently used first. Staff only (the policy returns none to anyone else).
export type SavedOpponent = { id: string; name: string; abbr: string; color: string; color2: string; logo_url: string | null; roster: Lineup };
export async function listOpponents(db: Db, teamId: string) {
  const { data } = await db.from('opponents').select('id, name, abbr, color, color2, logo_url, roster').eq('team_id', teamId).order('name');
  return (data ?? []) as SavedOpponent[];
}

// ---- Families, the calendar and messages ------------------------------------

// Parents and fans, for staff (the policy shows anyone else their own row).
export async function listMembers(db: Db, teamId: string) {
  const [{ data }, { data: kids }] = await Promise.all([
    db.from('team_members').select('user_id, role, status, profiles(display_name)').eq('team_id', teamId).order('created_at'),
    db.from('guardian_players').select('user_id, player_id').eq('team_id', teamId),
  ]);
  return ((data ?? []) as unknown as { user_id: string; role: MemberRole; status: 'pending' | 'active'; profiles: { display_name: string } | null }[])
    .map((r): Member => ({ user_id: r.user_id, role: r.role, status: r.status, display_name: r.profiles?.display_name ?? 'Parent',
      players: ((kids ?? []) as { user_id: string; player_id: string }[]).filter((k) => k.user_id === r.user_id).map((k) => k.player_id) }));
}
// The players a guardian is the parent of: their ids, then the rows the policy
// opens to them.
export async function myPlayers(db: Db, teamId: string, userId: string) {
  const { data } = await db.from('guardian_players').select('player_id').eq('team_id', teamId).eq('user_id', userId);
  const ids = ((data ?? []) as { player_id: string }[]).map((r) => r.player_id);
  if (!ids.length) return [];
  const { data: rows } = await db.from('players').select(PLAYER_COLS).in('id', ids);
  return (rows ?? []) as Player[];
}

const EVENT_COLS = 'id, team_id, kind, title, starts_at, ends_at, location, address, notes, canceled';
// From yesterday on, by default: the calendar looks ahead.
export async function listEvents(db: Db, teamId: string, from = new Date(Date.now() - 864e5).toISOString()) {
  const { data } = await db.from('team_events').select(EVENT_COLS).eq('team_id', teamId).gte('starts_at', from).order('starts_at');
  return (data ?? []) as TeamEvent[];
}
export async function getEvent(db: Db, teamId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.from('team_events').select(EVENT_COLS).eq('team_id', teamId).eq('id', id).maybeSingle<TeamEvent>();
  return data;
}
export async function listRsvps(db: Db, teamId: string) {
  const { data } = await db.from('rsvps').select('game_id, event_id, player_id, status, note').eq('team_id', teamId);
  return (data ?? []) as Rsvp[];
}
// Who is down to score each game: game id to names.
export async function listGameScorers(db: Db, gameIds: string[]) {
  if (!gameIds.length) return {} as Record<string, { user_id: string; name: string }[]>;
  const { data } = await db.from('game_scorers').select('game_id, user_id, profiles(display_name)').in('game_id', gameIds);
  const out: Record<string, { user_id: string; name: string }[]> = {};
  for (const r of (data ?? []) as unknown as { game_id: string; user_id: string; profiles: { display_name: string } | null }[]) {
    (out[r.game_id] ??= []).push({ user_id: r.user_id, name: r.profiles?.display_name ?? 'Scorer' });
  }
  return out;
}

// The newest messages in a channel, oldest first for reading down.
export async function listMessages(db: Db, teamId: string, channel: Channel, limit = 60) {
  const { data } = await db.from('team_messages').select('id, channel, user_id, body, created_at, profiles(display_name)')
    .eq('team_id', teamId).eq('channel', channel).order('id', { ascending: false }).limit(limit);
  return ((data ?? []) as unknown as (Message & { profiles: { display_name: string } | null })[])
    .map(({ profiles, ...m }) => ({ ...m, author: profiles?.display_name ?? 'Former member' })).reverse();
}
export async function orgAnnouncements(db: Db, orgId: string, limit = 5) {
  const { data } = await db.from('org_announcements').select('id, body, created_at, profiles(display_name)')
    .eq('org_id', orgId).order('id', { ascending: false }).limit(limit);
  return ((data ?? []) as unknown as { id: number; body: string; created_at: string; profiles: { display_name: string } | null }[])
    .map((r) => ({ id: r.id, body: r.body, created_at: r.created_at, author: r.profiles?.display_name ?? 'League' }));
}

// Which notifications a person wants from a team. No row means all on.
export async function notifyPrefs(db: Db, teamId: string, userId: string) {
  const { data } = await db.from('notify_settings').select('announcements, chat, schedule, games')
    .eq('team_id', teamId).eq('user_id', userId).maybeSingle<{ announcements: boolean; chat: boolean; schedule: boolean; games: boolean }>();
  return data ?? { announcements: true, chat: true, schedule: true, games: true };
}

// The calendar as a member sees it: games for everyone; events, answers and
// the roster for the family (the policies return none to a fan).
export async function loadCalendar(db: Db, team: Team, seat: Seat, userId: string) {
  const fam = seat !== 'fan';
  const [games, events, rsvps, roster, mine] = await Promise.all([
    listGames(db, team.id, undefined, { public: !fam }),
    fam ? listEvents(db, team.id) : Promise.resolve([] as TeamEvent[]),
    fam ? listRsvps(db, team.id) : Promise.resolve([] as Rsvp[]),
    isStaff(seat) ? listPlayers(db, team.id) : Promise.resolve([] as Player[]),
    seat === 'guardian' ? myPlayers(db, team.id, userId) : Promise.resolve([] as Player[]),
  ]);
  return { games, events, rsvps, roster: isStaff(seat) ? roster : mine, mine };
}
