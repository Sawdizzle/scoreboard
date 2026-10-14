-- SEC-5. apply_event, undo and touch_updated_at had a role-mutable search_path.
-- All three are SECURITY INVOKER so the usual escalation route is shut, but a
-- pinned path costs nothing and clears the advisor. The six SECURITY DEFINER
-- functions already pin theirs.
alter function scoreboard.apply_event(uuid, text, jsonb, jsonb) set search_path = scoreboard, pg_temp;
alter function scoreboard.undo(uuid) set search_path = scoreboard, pg_temp;
alter function scoreboard.touch_updated_at() set search_path = scoreboard, pg_temp;

-- PERF-6. Every owner-scoped policy called auth.uid() bare, so Postgres
-- re-evaluated it per row instead of once per statement. Irrelevant at five
-- rows; it is the kind of thing that only bites once events holds a season.
alter policy games_insert   on scoreboard.games   with check (owner_id = (select auth.uid()));
alter policy games_update   on scoreboard.games   using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy games_delete   on scoreboard.games   using (owner_id = (select auth.uid()));

alter policy events_insert  on scoreboard.events  with check (owner_id = (select auth.uid()));
alter policy events_update  on scoreboard.events  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy events_delete  on scoreboard.events  using (owner_id = (select auth.uid()));

alter policy rosters_select on scoreboard.rosters using (owner_id = (select auth.uid()));
alter policy rosters_insert on scoreboard.rosters with check (owner_id = (select auth.uid()));
alter policy rosters_update on scoreboard.rosters using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy rosters_delete on scoreboard.rosters using (owner_id = (select auth.uid()));

alter policy teams_select   on scoreboard.teams   using (owner_id = (select auth.uid()));
alter policy teams_insert   on scoreboard.teams   with check (owner_id = (select auth.uid()));
alter policy teams_update   on scoreboard.teams   using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy teams_delete   on scoreboard.teams   using (owner_id = (select auth.uid()));

alter policy presets_select on scoreboard.presets using (owner_id = (select auth.uid()));
alter policy presets_insert on scoreboard.presets with check (owner_id = (select auth.uid()));
alter policy presets_update on scoreboard.presets using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
alter policy presets_delete on scoreboard.presets using (owner_id = (select auth.uid()));

-- The two foreign keys with no covering index. Both are the "find everything
-- belonging to this user" direction, which is what a cascade delete walks.
create index if not exists events_owner_idx  on scoreboard.events  using btree (owner_id);
create index if not exists rosters_owner_idx on scoreboard.rosters using btree (owner_id);

-- SEC-3, as far as it goes. The games row is world-readable because the
-- anonymous OBS browser source has to read it and Realtime evaluates RLS as the
-- subscriber — there is no way to require the overlay's token here without
-- killing that. So the row is PUBLISHED, and that is a standing constraint on
-- what may go on it, not an oversight. Written down where the next person looks.
comment on policy games_read on scoreboard.games is
  'Deliberately public: the anonymous OBS browser source must read this row, and Realtime evaluates RLS as the subscriber, so locking it down kills the overlay. Treat every column here as published — anyone can enumerate the whole table. Anything private belongs in scoreboard.rosters, reached by token through get_roster().';
comment on policy events_read on scoreboard.events is
  'Owner-only. prev_state holds a full games-row snapshot, so a public read here would republish everything on that row plus anything since removed from it. Nothing in the app reads this table.';
