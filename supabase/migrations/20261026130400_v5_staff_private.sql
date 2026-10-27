-- =============================================================================
-- Who is on a team's staff is for that team's staff.
-- =============================================================================
-- profiles (every account's name) and team_staff (every seat, by team and
-- role) were readable by anyone, signed in or not. Now:
--   team_staff  your own seats, and every seat on a team you are staff of
--   profiles    your own name, and the names of staff on a team you share
-- anon reads neither.
-- =============================================================================

create function public.shares_team(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_staff me join public.team_staff them on them.team_id = me.team_id
     where me.user_id = (select auth.uid()) and them.user_id = p_user
  );
$$;
revoke all on function public.shares_team(uuid) from public, anon;
grant execute on function public.shares_team(uuid) to authenticated;

alter policy profiles_read on public.profiles to authenticated
  using (id = (select auth.uid()) or public.shares_team(id));
alter policy team_staff_read on public.team_staff to authenticated
  using (user_id = (select auth.uid()) or public.is_team_staff(team_id));

revoke select on public.profiles, public.team_staff from anon;
