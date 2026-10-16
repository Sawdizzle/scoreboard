-- =============================================================================
-- Stream sessions: close one that OBS never reported stopping.
-- =============================================================================
-- If OBS crashes or the computer loses power, no "stopped" report comes, and
-- the session stayed open: the next stream then opened none, and the next
-- game's chapters were timed from the old start. The overlay reports at
-- least once a minute while it is up, so a session whose last report is more
-- than three minutes old is closed at that last report before going on.
-- =============================================================================

create or replace function public.obs_report(p_token uuid, p_obs jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team uuid;
  v_open boolean;
  v_last timestamptz;
  v_now boolean := case when jsonb_typeof(p_obs->'streaming') = 'boolean' then (p_obs->>'streaming')::boolean end;
begin
  if jsonb_typeof(p_obs) <> 'object' or pg_column_size(p_obs) >= 16000 then return; end if;
  select c.team_id into v_team from public.channels c where c.token = p_token;
  if v_team is null then return; end if;
  select o.at into v_last from public.channel_obs o where o.team_id = v_team;
  if v_last is not null and v_last < now() - interval '3 minutes' then
    update public.stream_sessions set ended_at = v_last where team_id = v_team and ended_at is null;
  end if;
  v_open := exists (select 1 from public.stream_sessions where team_id = v_team and ended_at is null);
  insert into public.channel_obs (team_id, obs, at) values (v_team, p_obs, now())
  on conflict (team_id) do update set obs = excluded.obs, at = excluded.at;
  -- Streaming with no open session opens one; stopped with one open closes
  -- it. An unknown status (null: OBS gave no read access) changes nothing.
  if v_now is true and not v_open then
    insert into public.stream_sessions (team_id) values (v_team);
  elsif v_now is false and v_open then
    update public.stream_sessions set ended_at = now() where team_id = v_team and ended_at is null;
  end if;
end;
$$;
