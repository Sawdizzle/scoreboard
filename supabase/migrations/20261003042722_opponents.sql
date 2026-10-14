-- =============================================================================
-- Stage 5 — opponents a team has played, remembered.
-- =============================================================================
-- Scoreboard kept "saved teams": the other sides you play, each with its
-- colour and the lineup you last typed for it. Here an opponent that is not a
-- team on Pressbox was only a name on one game, and its lineup was typed
-- again every time.
--
-- opponents is that memory, per team and private to its staff: name, short
-- code, colour and the last lineup. New Game offers them; picking one fills
-- the game and loads its lineup; saving the other side's lineup in a game
-- updates it. It is not a team page and never public (PLAN.md, decision 3):
-- these are other clubs' players, typed in by our scorer.
-- =============================================================================

create table public.opponents (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  abbr       text not null check (char_length(abbr) between 1 and 6),
  color      text not null default '#7a8794' check (color ~ '^#[0-9a-fA-F]{6}$'),
  roster     jsonb not null default '{}' check (jsonb_typeof(roster) = 'object' and pg_column_size(roster) < 32768),
  updated_at timestamptz not null default now()
);
create unique index opponents_team_name on public.opponents (team_id, lower(name));
comment on table public.opponents is
  'Opponents not on Pressbox that a team has played: name, colour and the last lineup typed for them. Staff only, never public.';

create function public.opponents_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger opponents_touch before update on public.opponents
  for each row execute function public.opponents_touch();

alter table public.opponents enable row level security;

create policy opponents_read on public.opponents for select
  using (public.is_team_staff(team_id));
create policy opponents_insert on public.opponents for insert
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'scorer']));
create policy opponents_update on public.opponents for update
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'scorer']))
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'scorer']));
create policy opponents_delete on public.opponents for delete
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'scorer']));

revoke all on public.opponents from anon, authenticated;
grant select, delete on public.opponents to authenticated;
grant insert (team_id, name, abbr, color, roster) on public.opponents to authenticated;
grant update (abbr, color, roster) on public.opponents to authenticated;

revoke all on function public.opponents_touch() from public, anon, authenticated;
