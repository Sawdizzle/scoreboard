-- BUG-7. Saving a roster was two round trips: upsert the roster, then read
-- roster_rev off the local game object, add one, and write it back. Two devices
-- editing lineups between innings computed the same increment, so one bump was
-- lost and the overlay never re-pulled — it had no other way to know. And if the
-- second request failed on its own, the roster was saved with the overlay still
-- pointing at the old revision.
--
-- One statement each, one transaction, and roster_rev is incremented by the
-- database from its own value rather than from whatever the pad last saw.
--
-- SECURITY INVOKER on purpose: RLS is the check. The insert needs
-- rosters_insert (owner_id = auth.uid()), the conflict path needs
-- rosters_update, and the bump needs games_update — so a game that isn't yours
-- updates no rows, returns null, and raises.
create or replace function scoreboard.save_roster(p_game uuid, p_data jsonb)
returns integer
language plpgsql
set search_path = scoreboard, pg_temp
as $$
declare v_rev integer;
begin
  insert into scoreboard.rosters (game_id, owner_id, data, updated_at)
  values (p_game, auth.uid(), coalesce(p_data, '{}'::jsonb), now())
  on conflict (game_id) do update
    set data = excluded.data, updated_at = now();

  update scoreboard.games
     set roster_rev = roster_rev + 1
   where id = p_game
  returning roster_rev into v_rev;

  if v_rev is null then
    raise exception 'not your game' using errcode = '42501';
  end if;
  return v_rev;
end;
$$;

comment on function scoreboard.save_roster(uuid, jsonb) is
  'Write a game roster and bump games.roster_rev in one transaction. The bump is computed in the database, so two devices editing between innings cannot lose one anothers increment and leave the overlay pointing at a stale revision.';
