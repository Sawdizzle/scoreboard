// Row shapes, written by hand to match supabase/migrations. Swap for generated
// types once the project exists and `supabase gen types` can run against it.

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

export const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'UT'] as const;
export type Position = (typeof POSITIONS)[number];

export const PUBLIC_NAMES = ['full', 'first_initial', 'number'] as const;
export type PublicName = (typeof PUBLIC_NAMES)[number];

export type Team = {
  id: string;
  slug: string;
  name: string;
  abbr: string;
  color: string;
  logo_url: string | null;
  age_group: string | null;
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
