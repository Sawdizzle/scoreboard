-- =============================================================================
-- Faster reads of the play log and the lineups: the staff check, inline.
-- =============================================================================
-- game_events_read and game_lineups_read asked is_team_staff(game_team(game_id))
-- for every row. Both helpers are SECURITY DEFINER, so Postgres cannot fold
-- them into the query: the pad's reads of a long game paid two function calls
-- per row. The same check, written as joins, runs once as part of the plan.
--
-- Who may read is unchanged (tests/staff-read-schema.test.ts): anyone with a
-- seat on the game's team, or an admin of the org that team belongs to.
-- Both joins read only the caller's own rows of team_staff and org_members,
-- which their read policies always show (user_id = auth.uid()).
-- =============================================================================

alter policy game_events_read on public.game_events
  using (
    exists (select 1 from public.games g
              join public.team_staff s on s.team_id = g.team_id
             where g.id = game_events.game_id and s.user_id = (select auth.uid()))
    or exists (select 1 from public.games g
                 join public.teams t on t.id = g.team_id
                 join public.org_members m on m.org_id = t.org_id
                where g.id = game_events.game_id and m.user_id = (select auth.uid()))
  );

alter policy game_lineups_read on public.game_lineups
  using (
    exists (select 1 from public.games g
              join public.team_staff s on s.team_id = g.team_id
             where g.id = game_lineups.game_id and s.user_id = (select auth.uid()))
    or exists (select 1 from public.games g
                 join public.teams t on t.id = g.team_id
                 join public.org_members m on m.org_id = t.org_id
                where g.id = game_lineups.game_id and m.user_id = (select auth.uid()))
  );
