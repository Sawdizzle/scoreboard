-- =============================================================================
-- Stage 2b — games and lineups.
-- =============================================================================
-- A game belongs to the team whose staff will score it (team_id). The other
-- side is either another team on Pressbox (opponent_team_id, its name and
-- colour copied in when the game is made) or just a name typed in.
--
-- Lineups are kept apart from the game row, as Scoreboard keeps rosters apart
-- from its games: the game row is public (schedules, and in Stage 3 the
-- overlay reads it live), and a lineup carries names. Staff read lineups;
-- the public never does. The overlay will reach them in Stage 3 through a
-- token, the way Scoreboard's get_roster() does.
--
-- A lineup is stored as the blob Scoreboard's rules engine already works on
-- ({ batters: [{ bid, num, name }], positions: { P: bid, ... }, pitcher }),
-- with `bid` set to the player's id for a rostered player. That keeps the
-- engine unchanged when it arrives in 2c, and every play it records names a
-- real player.
--
-- Sides are 'us' and 'them', not home and away: swapping home and away after
-- the lineups are in must not swap the lineups.
-- =============================================================================

create table public.games (
  id               uuid primary key default gen_random_uuid(),
  team_id          uuid not null references public.teams(id) on delete cascade,
  season_id        uuid references public.seasons(id) on delete set null,
  counts_for_stats boolean not null default true,
  opponent_team_id uuid references public.teams(id) on delete set null,
  opponent_name    text not null check (char_length(opponent_name) between 1 and 60),
  opponent_abbr    text not null check (char_length(opponent_abbr) between 1 and 6),
  opponent_color   text not null default '#7a8794' check (opponent_color ~ '^#[0-9a-fA-F]{6}$'),
  is_home          boolean not null default true,
  starts_at        timestamptz,
  venue            text check (venue is null or char_length(venue) <= 80),
  status           text not null default 'scheduled' check (status in ('scheduled', 'live', 'final')),
  -- The game as the pad leaves it (count, outs, bases, score, line score...).
  -- Filled from Stage 2c; empty until the first pitch.
  live             jsonb not null default '{}',
  created_by       uuid default auth.uid() references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint games_not_yourself check (opponent_team_id is null or opponent_team_id <> team_id)
);
create index games_team_idx on public.games (team_id, starts_at);
create index games_season_idx on public.games (season_id);
create index games_opponent_idx on public.games (opponent_team_id);
comment on table public.games is
  'A game, owned by the team that scores it. Public: no names on this row. Lineups are in game_lineups.';

create table public.game_lineups (
  game_id    uuid not null references public.games(id) on delete cascade,
  side       text not null check (side in ('us', 'them')),
  data       jsonb not null default '{}' check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 32768),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  primary key (game_id, side)
);
comment on table public.game_lineups is
  'One lineup per side per game: { batters: [{bid, num, name}], positions: {P: bid, ...}, pitcher }. Staff only.';

-- The season has to be this team's season.
create function public.games_check()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.season_id is not null
     and not exists (select 1 from public.seasons where id = new.season_id and team_id = new.team_id) then
    raise exception 'That season is not this team''s.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger games_check before insert or update on public.games
  for each row execute function public.games_check();

create function public.game_lineups_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger game_lineups_touch before insert or update on public.game_lineups
  for each row execute function public.game_lineups_touch();

-- Whose staff may do what with a game. Making a game and setting lineups is
-- for anyone who coaches or scores; deleting one is for the team's leads.
create function public.game_team(p_game uuid)
returns uuid
language sql stable security definer
set search_path = public, pg_temp
as $$ select team_id from public.games where id = p_game $$;

-- ------------------------------------------------------------------- RLS ----
alter table public.games enable row level security;
alter table public.game_lineups enable row level security;

create policy games_read   on public.games for select using (true);
create policy games_insert on public.games for insert
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'scorer']));
create policy games_update on public.games for update
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'scorer']))
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'scorer']));
create policy games_delete on public.games for delete
  using (public.has_team_role(team_id, array['organizer', 'head_coach']));

create policy game_lineups_read on public.game_lineups for select
  using (public.is_team_staff(public.game_team(game_id)));
create policy game_lineups_insert on public.game_lineups for insert
  with check (public.has_team_role(public.game_team(game_id), array['organizer', 'head_coach', 'coach', 'scorer']));
create policy game_lineups_update on public.game_lineups for update
  using (public.has_team_role(public.game_team(game_id), array['organizer', 'head_coach', 'coach', 'scorer']))
  with check (public.has_team_role(public.game_team(game_id), array['organizer', 'head_coach', 'coach', 'scorer']));
create policy game_lineups_delete on public.game_lineups for delete
  using (public.has_team_role(public.game_team(game_id), array['organizer', 'head_coach', 'coach', 'scorer']));

-- ---------------------------------------------------------------- grants ----
-- `live` and `status` are not in the update list: the pad writes them through
-- its own function in 2c, never as a plain row edit.
revoke all on public.games, public.game_lineups from anon, authenticated;
grant select on public.games to anon, authenticated;
grant insert (team_id, season_id, counts_for_stats, opponent_team_id, opponent_name, opponent_abbr,
              opponent_color, is_home, starts_at, venue) on public.games to authenticated;
grant update (season_id, counts_for_stats, opponent_team_id, opponent_name, opponent_abbr,
              opponent_color, is_home, starts_at, venue) on public.games to authenticated;
grant delete on public.games to authenticated;
grant select, delete on public.game_lineups to authenticated;
grant insert (game_id, side, data) on public.game_lineups to authenticated;
grant update (data) on public.game_lineups to authenticated;

revoke all on function public.games_check()       from public, anon, authenticated;
revoke all on function public.game_lineups_touch() from public, anon, authenticated;
revoke all on function public.game_team(uuid)     from public, anon;
grant execute on function public.game_team(uuid) to authenticated;
