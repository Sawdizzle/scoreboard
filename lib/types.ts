// Row shapes, written by hand to match supabase/migrations. Swap for generated
// types once the project exists and `supabase gen types` can run against it.
import type { Clock, GameSettings } from './broadcast.ts';
import type { Sport } from './sports.ts';

export const ROLES = ['organizer', 'head_coach', 'coach', 'scorer', 'media'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  organizer: 'Organizer',
  head_coach: 'Head coach',
  coach: 'Coach',
  scorer: 'Scorer',
  media: 'Media',
};
// One line per role, shown beside a seat and on the invite screen.
export const ROLE_CAN: Record<Role, string> = {
  organizer: 'Owns the team and its seats',
  head_coach: 'Team, roster and seasons',
  coach: 'Lineups and scoring',
  scorer: 'Scores games',
  media: 'Runs the broadcast',
};
export const SEATS = 5;

// What the database lets each role write in this stage (see the policies).
export const canEditTeam = (role: Role | null) => role === 'organizer' || role === 'head_coach';
export const canManageSeats = (role: Role | null) => role === 'organizer';
// Games and lineups: anyone who coaches or scores. Media watches.
export const canRunGames = (role: Role | null) => role !== null && role !== 'media';
// AI recaps: organizers and coaches write and publish them.
export const canWriteRecaps = (role: Role | null) => role === 'organizer' || role === 'head_coach' || role === 'coach';

export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'UT'] as const;
export type Position = (typeof POSITIONS)[number];

export const PUBLIC_NAMES = ['full', 'first_initial', 'number'] as const;
export type PublicName = (typeof PUBLIC_NAMES)[number];

// How a team names its players everywhere (teams.name_format). Each player's
// public_name caps it on the stream and the public pages.
export const NAME_FORMATS = ['full', 'initial_last', 'last', 'first', 'first_initial'] as const;
export type NameFormat = (typeof NAME_FORMATS)[number];

export type Team = {
  id: string;
  slug: string;
  name: string;
  // What screens and the scorebug show; up to 24 characters.
  display_name: string;
  // Up to 6, for the tightest spots only (a line-score row).
  abbr: string;
  color: string;
  color2: string;
  palette: string[];
  logo_url: string | null;
  age_group: string | null;
  // How the team's players are named; 'first_initial' until the team picks another.
  name_format: NameFormat;
  // True hides the roster, games and stats from everyone not on the staff.
  private: boolean;
};

export type Player = {
  id: string;
  team_id: string;
  first_name: string;
  last_name: string;
  number: string;
  bats: 'R' | 'L' | 'S' | null;
  throws: 'R' | 'L' | null;
  positions: Position[];
  public_name: PublicName;
  active: boolean;
};

export type Season = {
  id: string;
  team_id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_current: boolean;
  game_innings: number;
};

export type StaffMember = { user_id: string; role: Role; display_name: string };
export type Invite = { token: string; role: Role; expires_at: string };

// What a form action hands back to the form that called it.
export type FormState = { error?: string; ok?: string };

export type Game = {
  id: string;
  // Baseball has lineups, the pad and stats; the others are score only.
  sport: Sport;
  team_id: string;
  season_id: string | null;
  counts_for_stats: boolean;
  opponent_team_id: string | null;
  opponent_name: string;
  opponent_abbr: string;
  opponent_color: string;
  is_home: boolean;
  starts_at: string | null;
  venue: string | null;
  // The field's street address (directions, and the weather), and the tournament's page.
  address?: string | null;
  tournament_url?: string | null;
  status: 'scheduled' | 'live' | 'final';
  live: Record<string, unknown>;
  // The game clock, the game's rules, and where the venue is (for its weather).
  clock?: Clock | null;
  settings?: GameSettings;
  venue_geo?: { lat: number; lon: number; tz?: string; label?: string } | null;
  // The opponent's own team row, when they are on Scoreboard.
  opponent?: Team | null;
  // The opponent from the team's own list (Opponents screen), when the game is against one.
  opponent_id?: string | null;
  saved?: { name: string; abbr: string; color: string; color2: string; logo_url: string | null } | null;
};

// A lineup, in the shape Scoreboard's rules engine (lib/rules) works on. `bid`
// is the player's id when the player is on a roster here; a player typed in at
// the field gets a made-up one.
export type LineupBatter = { bid: string; num: string; name: string };
export type Lineup = { batters: LineupBatter[]; positions: Record<string, string>; pitcher?: { num: string; name: string } };
export type Side = 'us' | 'them';
