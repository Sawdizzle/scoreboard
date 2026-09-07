-- SEC-2. ack_replay, set_obs_status and set_obs_scenes were SECURITY DEFINER,
-- executable by anon, and authorised on nothing but p_game -- a UUID that is in
-- every overlay URL and every recap link handed to parents. Anyone holding one
-- could spoof the pad's OBS panel mid-broadcast: fake "clip saved", claim the
-- replay buffer was down, or replace the camera list.
--
-- They now require the overlay token from scoreboard.rosters -- the same secret
-- get_roster already demands, and the one the overlay already carries in &t=.
-- rotate_overlay_token() therefore revokes relay access along with roster access.
--
-- p_token is trailing with a default so a not-yet-redeployed overlay still makes
-- a well-formed call; it just gets a clear error instead of writing.

create or replace function scoreboard.overlay_token_ok(p_game uuid, p_token uuid)
returns boolean
language sql
stable
security definer
set search_path = scoreboard, pg_temp
as $$
  select exists (
    select 1 from scoreboard.rosters r
     where r.game_id = p_game and p_token is not null and r.token = p_token
  );
$$;
-- Internal only: not an RPC, so it can never be used as a token oracle.
revoke all on function scoreboard.overlay_token_ok(uuid, uuid) from public, anon, authenticated;

drop function if exists scoreboard.ack_replay(uuid, bigint, boolean, text, integer, boolean);
create function scoreboard.ack_replay(
  p_game uuid, p_nonce bigint, p_ok boolean, p_code text,
  p_level integer default null, p_buffering boolean default null,
  p_token uuid default null)
returns void
language plpgsql
security definer
set search_path = scoreboard, pg_temp
as $$
begin
  if not scoreboard.overlay_token_ok(p_game, p_token) then
    raise exception 'overlay token required' using errcode = '42501';
  end if;
  if p_code is null or length(p_code) > 32 then
    raise exception 'bad ack code';
  end if;
  update scoreboard.games
     set replay_ack = jsonb_build_object(
           'nonce', p_nonce, 'ok', coalesce(p_ok, false), 'code', p_code,
           'level', p_level, 'buffering', p_buffering, 'at', now())
   where id = p_game;
end;
$$;

drop function if exists scoreboard.set_obs_status(uuid, integer, boolean, boolean, boolean, boolean);
create function scoreboard.set_obs_status(
  p_game uuid, p_level integer, p_streaming boolean, p_recording boolean,
  p_paused boolean, p_buffer boolean, p_token uuid default null)
returns void
language plpgsql
security definer
set search_path = scoreboard, pg_temp
as $$
begin
  if not scoreboard.overlay_token_ok(p_game, p_token) then
    raise exception 'overlay token required' using errcode = '42501';
  end if;
  update scoreboard.games
     set obs_status = jsonb_build_object(
           'level', p_level, 'streaming', p_streaming, 'recording', p_recording,
           'paused', p_paused, 'buffer', p_buffer, 'at', now())
   where id = p_game;
end;
$$;

drop function if exists scoreboard.set_obs_scenes(uuid, integer, text, jsonb);
create function scoreboard.set_obs_scenes(
  p_game uuid, p_level integer, p_current text, p_scenes jsonb,
  p_token uuid default null)
returns void
language plpgsql
security definer
set search_path = scoreboard, pg_temp
as $$
begin
  if not scoreboard.overlay_token_ok(p_game, p_token) then
    raise exception 'overlay token required' using errcode = '42501';
  end if;
  if p_scenes is not null and (jsonb_typeof(p_scenes) <> 'array' or jsonb_array_length(p_scenes) > 60) then
    raise exception 'bad scene list';
  end if;
  update scoreboard.games
     set obs_scenes = jsonb_build_object(
           'level', p_level, 'current', left(coalesce(p_current, ''), 200),
           'list', coalesce(p_scenes, '[]'::jsonb), 'at', now())
   where id = p_game;
end;
$$;
