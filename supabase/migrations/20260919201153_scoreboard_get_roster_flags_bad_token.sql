-- get_roster used to answer '{}' both for a real roster nobody had filled in
-- and for a token that is not this game's. An overlay link copied from one game
-- with only ?game= changed therefore showed the new game's team names over an
-- empty lineup, with nothing to say the link was wrong.
--
-- Now a token that matches no roster row answers NULL; a matching row still
-- answers its data (or '{}'). Old overlays did `data || {}`, so they behave as
-- before. New overlays show "Overlay link is out of date" on the lineup and
-- defense cards. Same signature, same grants, still SECURITY DEFINER.

create or replace function scoreboard.get_roster(p_game uuid, p_token uuid)
returns jsonb
language plpgsql
stable security definer
set search_path = scoreboard, pg_temp
as $$
declare v_data jsonb; v_found boolean := false;
begin
  select r.data, true into v_data, v_found
  from scoreboard.rosters r
  where r.game_id = p_game and p_token is not null and r.token = p_token;
  if not coalesce(v_found, false) then
    return null;
  end if;
  return coalesce(v_data, '{}'::jsonb);
end;
$$;
