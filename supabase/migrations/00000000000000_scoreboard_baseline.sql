-- =============================================================================
-- scoreboard — baseline schema
-- =============================================================================
-- Everything the app needs on the database side, as one runnable file: stand up
-- a new project, a staging branch, or a local stack from this and the app works.
--
-- This exists because the schema, the RLS policies and the RPCs only ever lived
-- in the hosted project. The repo had one edge function and nothing else, so the
-- data layer was the single part of a deliberately no-build app that could not
-- be recovered from the files you can see.
--
-- Squashed from the state of the live project rather than replayed from the
-- fifteen migrations that produced it; those exist only in the remote history
-- (20260812225438_live_scoreboard onward). Changes from 2026-09-06 forward are
-- individual migrations alongside this file.
--
-- The remote already has this schema, so the CLI must be told this baseline is
-- accounted for rather than run against it:
--   supabase migration repair --status applied 00000000000000
-- =============================================================================

create schema if not exists scoreboard;
grant usage on schema scoreboard to anon, authenticated, service_role;

-- ---------------------------------------------------------------- tables ----
create table scoreboard.games (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  status text default 'setup'::text not null,
  home_name text default 'Home'::text not null,
  away_name text default 'Visitor'::text not null,
  home_abbr text default 'HOME'::text not null,
  away_abbr text default 'VIS'::text not null,
  home_logo_url text,
  away_logo_url text,
  home_color text default '#1b2a41'::text not null,
  away_color text default '#7a8794'::text not null,
  theme text default 'nightgame'::text not null,
  sound_pack text default 'bigleague'::text not null,
  scorebug_position text default 'bottom-bar'::text not null,
  scorebug_scale numeric default 1.0 not null,
  time_limit_seconds integer,
  clock_running boolean default false not null,
  clock_ends_at timestamp with time zone,
  clock_remaining_seconds integer,
  inning integer default 1 not null,
  half text default 'top'::text not null,
  balls integer default 0 not null,
  strikes integer default 0 not null,
  outs integer default 0 not null,
  bases jsonb default '{"first": false, "third": false, "second": false}'::jsonb not null,
  home_score integer default 0 not null,
  away_score integer default 0 not null,
  home_hits integer default 0 not null,
  away_hits integer default 0 not null,
  home_errors integer default 0 not null,
  away_errors integer default 0 not null,
  line_score jsonb default '[]'::jsonb not null,
  batter_name text,
  batter_number text,
  pitcher_name text,
  pitch_count integer default 0 not null,
  show_batter boolean default false not null,
  show_pitcher boolean default false not null,
  show_pitchcount boolean default false not null,
  show_clock boolean default true not null,
  show_runrule boolean default false not null,
  run_rule_diff integer default 10,
  rally_mode boolean default false not null,
  current_animation jsonb,
  audio jsonb default '{"cats": {"organ": 1, "moments": 1}, "muted": false, "master": 0.8}'::jsonb not null,
  sport text default 'baseball'::text not null,
  style text default 'bar'::text not null,
  state jsonb default '{}'::jsonb not null,
  look jsonb default '{}'::jsonb not null,
  card jsonb,
  lineups jsonb default '{}'::jsonb not null,
  show_rhe boolean default false not null,
  regulation_innings integer default 0 not null,
  replay_cmd jsonb,
  replay_ack jsonb,
  auto_clip boolean default false not null,
  starts_at timestamp with time zone,
  scene_cmd jsonb,
  obs_scenes jsonb,
  obs_cmd jsonb,
  obs_status jsonb,
  roster_rev integer default 0 not null,
  sponsors jsonb default '{}'::jsonb not null
);

create table scoreboard.events (
  id bigint generated always as identity,
  game_id uuid not null,
  owner_id uuid default auth.uid() not null,
  created_at timestamp with time zone default now() not null,
  type text not null,
  payload jsonb default '{}'::jsonb not null,
  prev_state jsonb default '{}'::jsonb not null,
  undone boolean default false not null
);

create table scoreboard.rosters (
  game_id uuid not null,
  owner_id uuid default auth.uid() not null,
  data jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null,
  token uuid default gen_random_uuid() not null
);

create table scoreboard.teams (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  abbr text,
  color text,
  logo_url text,
  roster jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table scoreboard.presets (
  id uuid default gen_random_uuid() not null,
  owner_id uuid default auth.uid() not null,
  name text not null,
  settings jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

-- ----------------------------------------------------------- constraints ----
alter table scoreboard.games add constraint games_pkey primary key (id);
alter table scoreboard.games add constraint games_owner_id_fkey foreign key (owner_id) references auth.users(id);
alter table scoreboard.games add constraint games_balls_check check (((balls >= 0) and (balls <= 4)));
alter table scoreboard.games add constraint games_strikes_check check (((strikes >= 0) and (strikes <= 3)));
alter table scoreboard.games add constraint games_outs_check check (((outs >= 0) and (outs <= 3)));
alter table scoreboard.games add constraint games_half_check check ((half = any (array['top'::text, 'bottom'::text])));
alter table scoreboard.games add constraint games_status_check check ((status = any (array['setup'::text, 'live'::text, 'final'::text])));
alter table scoreboard.games add constraint games_sport_check check ((sport = any (array['baseball'::text, 'football'::text, 'soccer'::text, 'volleyball'::text, 'basketball'::text])));

alter table scoreboard.events add constraint events_pkey primary key (id);
alter table scoreboard.events add constraint events_game_id_fkey foreign key (game_id) references scoreboard.games(id) on delete cascade;
alter table scoreboard.events add constraint events_owner_id_fkey foreign key (owner_id) references auth.users(id);

alter table scoreboard.rosters add constraint rosters_pkey primary key (game_id);
alter table scoreboard.rosters add constraint rosters_game_id_fkey foreign key (game_id) references scoreboard.games(id) on delete cascade;
alter table scoreboard.rosters add constraint rosters_owner_id_fkey foreign key (owner_id) references auth.users(id);

alter table scoreboard.teams add constraint teams_pkey primary key (id);
alter table scoreboard.teams add constraint teams_owner_id_name_key unique (owner_id, name);
alter table scoreboard.teams add constraint teams_owner_id_fkey foreign key (owner_id) references auth.users(id) on delete cascade;

alter table scoreboard.presets add constraint presets_pkey primary key (id);
alter table scoreboard.presets add constraint presets_owner_id_fkey foreign key (owner_id) references auth.users(id);

-- --------------------------------------------------------------- indexes ----
create index games_owner_idx on scoreboard.games using btree (owner_id, updated_at desc);
create index events_game_idx on scoreboard.events using btree (game_id, id desc);
create index presets_owner_idx on scoreboard.presets using btree (owner_id, name);

-- -------------------------------------------------------------- comments ----
comment on column scoreboard.games.lineups is 'DEPRECATED and kept empty — rosters live in scoreboard.rosters, which is owner-only. Do not write here: this row is world-readable.';
comment on column scoreboard.games.show_rhe is 'When true, the live baseball scorebug shows a compact H/E block next to each team''s runs (R is the existing runs number). Written directly via setup, not through apply_event.';
comment on column scoreboard.games.regulation_innings is 'Baseball: the final scheduled inning (e.g. 6 for youth, 7 HS, 9 pro). 0 = off. When > 0, a home lead-change in the bottom of this inning or later auto-fires the walk-off moment. Written directly via setup, not apply_event.';
comment on column scoreboard.games.replay_cmd is 'Transient "save the replay buffer" trigger from the control pad: {nonce, at}. The overlay fires only on a strictly-newer nonce (so reload/undo never re-clip). Written directly, not via apply_event.';
comment on column scoreboard.games.replay_ack is 'Overlay''s answer to replay_cmd: {nonce, ok, code, level, buffering, at}. code is saved|nobuffer|noperm|failed, or hello for the capability report an overlay writes when it loads inside OBS. Written only through scoreboard.ack_replay().';
comment on column scoreboard.games.auto_clip is 'When true, the big-play stingers (home run, walk-off, double play, big play, touchdown, goal) also save the OBS replay buffer. Opt-in per game; written directly, not via apply_event.';
comment on column scoreboard.games.starts_at is 'Scheduled first pitch. Drives the countdown on the full-page "Starting Soon" takeover card; null just hides the countdown. Written directly via setup, not apply_event.';
comment on column scoreboard.games.scene_cmd is 'Transient "switch to this OBS scene" trigger from the control pad: {nonce, name}. The overlay fires only on a strictly-newer nonce. Written directly, not via apply_event.';
comment on column scoreboard.games.obs_scenes is 'What the overlay sees of OBS: {level, current, list, at}. Refreshed on load and on OBS''s own scene-changed / scene-list-changed events, so the pad tracks the live scene without polling. Written only through scoreboard.set_obs_scenes().';
comment on column scoreboard.games.obs_cmd is 'Transient OBS action from the control pad: {nonce, action} where action is stream_start|stream_stop|record_start|record_stop|buffer_start|buffer_stop. Fires only on a strictly-newer nonce. Written directly, not via apply_event.';
comment on column scoreboard.games.obs_status is 'What OBS is doing: {level, streaming, recording, paused, buffer, at}. Refreshed on load and on OBS''s own streaming/recording/replay-buffer events, so the pad never polls. Written only through scoreboard.set_obs_status().';
comment on column scoreboard.games.roster_rev is 'Bumped on every roster write. Rides Realtime so the overlay knows to re-pull the roster it cannot subscribe to directly.';
comment on column scoreboard.games.sponsors is 'Sponsor rotation: {list:[{name,logo}], rotate:bool, every:int seconds between, secs:int seconds on screen}.';
comment on column scoreboard.rosters.token is 'Secret in the overlay URL (&t=). Lives here, not on games, because games is world-readable — a token anyone can read guards nothing. Rotating it revokes every link ever shared.';
comment on table scoreboard.teams is 'Per-user reusable teams: identity (name/abbr/color/logo) + roster jsonb (a lineups[side] blob: {pitcher, batters, positions}). Loaded into a game side to skip re-entry.';

-- ------------------------------------------------------------- functions ----
-- Kept verbatim from the live project (pg_get_functiondef), so this file and the
-- database cannot drift in the part hardest to reconstruct by hand.

CREATE OR REPLACE FUNCTION scoreboard.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end $function$;

CREATE OR REPLACE FUNCTION scoreboard.server_now()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
 SET search_path TO 'scoreboard', 'pg_temp'
AS $function$ select now() $function$;

CREATE OR REPLACE FUNCTION scoreboard.overlay_token_ok(p_game uuid, p_token uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'scoreboard', 'pg_temp'
AS $function$
  select exists (
    select 1 from scoreboard.rosters r
     where r.game_id = p_game and p_token is not null and r.token = p_token
  );
$function$;

CREATE OR REPLACE FUNCTION scoreboard.get_roster(p_game uuid, p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'scoreboard', 'pg_temp'
AS $function$
declare v_data jsonb;
begin
  select r.data into v_data
  from scoreboard.rosters r
  where r.game_id = p_game and r.token = p_token;
  return coalesce(v_data, '{}'::jsonb);
end;
$function$;

CREATE OR REPLACE FUNCTION scoreboard.overlay_token(p_game uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'scoreboard', 'pg_temp'
AS $function$
declare v_token uuid; v_owner uuid;
begin
  select owner_id into v_owner from scoreboard.games where id = p_game;
  if v_owner is null or v_owner <> auth.uid() then raise exception 'not your game'; end if;
  insert into scoreboard.rosters (game_id, owner_id) values (p_game, v_owner)
    on conflict (game_id) do nothing;
  select token into v_token from scoreboard.rosters where game_id = p_game;
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION scoreboard.rotate_overlay_token(p_game uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'scoreboard', 'pg_temp'
AS $function$
declare v_token uuid;
begin
  perform scoreboard.overlay_token(p_game); -- owner check + row exists
  update scoreboard.rosters set token = gen_random_uuid() where game_id = p_game
    returning token into v_token;
  return v_token;
end;
$function$;

CREATE OR REPLACE FUNCTION scoreboard.ack_replay(p_game uuid, p_nonce bigint, p_ok boolean, p_code text, p_level integer DEFAULT NULL::integer, p_buffering boolean DEFAULT NULL::boolean, p_token uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'scoreboard', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION scoreboard.set_obs_status(p_game uuid, p_level integer, p_streaming boolean, p_recording boolean, p_paused boolean, p_buffer boolean, p_token uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'scoreboard', 'pg_temp'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION scoreboard.set_obs_scenes(p_game uuid, p_level integer, p_current text, p_scenes jsonb, p_token uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'scoreboard', 'pg_temp'
AS $function$
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
$function$;

-- apply_event and undo are SECURITY INVOKER on purpose: RLS decides whether the
-- caller may touch this game, and events.owner_id defaults to auth.uid().
CREATE OR REPLACE FUNCTION scoreboard.apply_event(p_game uuid, p_type text, p_new jsonb, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS scoreboard.games
 LANGUAGE plpgsql
AS $function$
declare prev jsonb; result scoreboard.games;
begin
  select to_jsonb(g.*) - 'lineups' into prev from scoreboard.games g where g.id = p_game;
  if prev is null then raise exception 'game % not found', p_game; end if;

  update scoreboard.games g set
    (status, home_name, away_name, home_abbr, away_abbr, home_logo_url, away_logo_url,
     home_color, away_color, theme, sound_pack, scorebug_position, scorebug_scale,
     time_limit_seconds, clock_running, clock_ends_at, clock_remaining_seconds,
     inning, half, balls, strikes, outs, bases,
     home_score, away_score, home_hits, away_hits, home_errors, away_errors, line_score,
     batter_name, batter_number, pitcher_name, pitch_count,
     show_batter, show_pitcher, show_pitchcount, show_clock, show_runrule, run_rule_diff,
     rally_mode, current_animation, sport, style, state)
    = (select m.status, m.home_name, m.away_name, m.home_abbr, m.away_abbr, m.home_logo_url, m.away_logo_url,
              m.home_color, m.away_color, m.theme, m.sound_pack, m.scorebug_position, m.scorebug_scale,
              m.time_limit_seconds, m.clock_running, m.clock_ends_at, m.clock_remaining_seconds,
              m.inning, m.half, m.balls, m.strikes, m.outs, m.bases,
              m.home_score, m.away_score, m.home_hits, m.away_hits, m.home_errors, m.away_errors, m.line_score,
              m.batter_name, m.batter_number, m.pitcher_name, m.pitch_count,
              m.show_batter, m.show_pitcher, m.show_pitchcount, m.show_clock, m.show_runrule, m.run_rule_diff,
              m.rally_mode, m.current_animation, m.sport, m.style, m.state
       from jsonb_populate_record((select gg from scoreboard.games gg where gg.id = p_game), p_new) as m)
  where g.id = p_game
  returning * into result;

  insert into scoreboard.events(game_id, type, payload, prev_state)
  values (p_game, p_type, coalesce(p_payload, '{}'::jsonb), prev);
  return result;
end;
$function$;

CREATE OR REPLACE FUNCTION scoreboard.undo(p_game uuid)
 RETURNS scoreboard.games
 LANGUAGE plpgsql
AS $function$
declare ev scoreboard.events; result scoreboard.games;
begin
  select * into ev from scoreboard.events where game_id = p_game and not undone order by id desc limit 1;
  if ev.id is null then select * into result from scoreboard.games where id = p_game; return result; end if;

  update scoreboard.games g set
    (status, home_name, away_name, home_abbr, away_abbr, home_logo_url, away_logo_url,
     home_color, away_color, theme, sound_pack, scorebug_position, scorebug_scale,
     time_limit_seconds, clock_running, clock_ends_at, clock_remaining_seconds,
     inning, half, balls, strikes, outs, bases,
     home_score, away_score, home_hits, away_hits, home_errors, away_errors, line_score,
     batter_name, batter_number, pitcher_name, pitch_count,
     show_batter, show_pitcher, show_pitchcount, show_clock, show_runrule, run_rule_diff,
     rally_mode, current_animation, sport, style, state)
    = (select m.status, m.home_name, m.away_name, m.home_abbr, m.away_abbr, m.home_logo_url, m.away_logo_url,
              m.home_color, m.away_color, m.theme, m.sound_pack, m.scorebug_position, m.scorebug_scale,
              m.time_limit_seconds, m.clock_running, m.clock_ends_at, m.clock_remaining_seconds,
              m.inning, m.half, m.balls, m.strikes, m.outs, m.bases,
              m.home_score, m.away_score, m.home_hits, m.away_hits, m.home_errors, m.away_errors, m.line_score,
              m.batter_name, m.batter_number, m.pitcher_name, m.pitch_count,
              m.show_batter, m.show_pitcher, m.show_pitchcount, m.show_clock, m.show_runrule, m.run_rule_diff,
              m.rally_mode, m.current_animation, m.sport, m.style, m.state
       from jsonb_populate_record(null::scoreboard.games, ev.prev_state) as m)
  where g.id = p_game
  returning * into result;

  update scoreboard.events set undone = true where id = ev.id;
  return result;
end; $function$;

comment on function scoreboard.server_now() is
  'Shared clock reference. The pad and the overlay each measure their offset from this once at load, so nonces stay monotonic across devices and a game clock written on one device reads correctly on another.';

-- Internal only: never an RPC, so it cannot be used as a token oracle.
revoke all on function scoreboard.overlay_token_ok(uuid, uuid) from public, anon, authenticated;
-- As on the live project: the token issuers are for signed-in owners only, and
-- the roster read is for the overlay (anon) and the pad. Added 2026-09-23 when a
-- rebuild from these files on a Supabase branch showed the live grants were
-- tighter than this file.
revoke all on function scoreboard.overlay_token(uuid) from public, anon, service_role;
revoke all on function scoreboard.rotate_overlay_token(uuid) from public, anon, service_role;
grant execute on function scoreboard.overlay_token(uuid) to authenticated;
grant execute on function scoreboard.rotate_overlay_token(uuid) to authenticated;
revoke all on function scoreboard.get_roster(uuid, uuid) from public, service_role;
grant execute on function scoreboard.get_roster(uuid, uuid) to anon, authenticated;

-- -------------------------------------------------------------- triggers ----
create trigger games_touch before update on scoreboard.games
  for each row execute function scoreboard.touch_updated_at();

-- ------------------------------------------------------------------ RLS ----
-- games is publicly readable because the anonymous OBS browser source has to
-- read it, and Realtime evaluates RLS as the subscriber. Treat that row as
-- published: nothing private goes on it. Rosters live in their own owner-only
-- table, reached by token through get_roster().
alter table scoreboard.games enable row level security;
alter table scoreboard.events enable row level security;
alter table scoreboard.rosters enable row level security;
alter table scoreboard.teams enable row level security;
alter table scoreboard.presets enable row level security;

create policy games_read on scoreboard.games for select using (true);
create policy games_insert on scoreboard.games for insert with check (owner_id = auth.uid());
create policy games_update on scoreboard.games for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy games_delete on scoreboard.games for delete using (owner_id = auth.uid());

-- The undo log holds a full snapshot of the game row per event. Owner-only:
-- nothing in the app reads this table, and a public read here was how rosters
-- stayed world-visible after they were moved off games.
create policy events_read on scoreboard.events for select using (owner_id = (select auth.uid()));
create policy events_insert on scoreboard.events for insert with check (owner_id = auth.uid());
create policy events_update on scoreboard.events for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy events_delete on scoreboard.events for delete using (owner_id = auth.uid());

create policy rosters_select on scoreboard.rosters for select using (owner_id = auth.uid());
create policy rosters_insert on scoreboard.rosters for insert with check (owner_id = auth.uid());
create policy rosters_update on scoreboard.rosters for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy rosters_delete on scoreboard.rosters for delete using (owner_id = auth.uid());

create policy teams_select on scoreboard.teams for select using (owner_id = auth.uid());
create policy teams_insert on scoreboard.teams for insert with check (owner_id = auth.uid());
create policy teams_update on scoreboard.teams for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy teams_delete on scoreboard.teams for delete using (owner_id = auth.uid());

create policy presets_select on scoreboard.presets for select using (owner_id = auth.uid());
create policy presets_insert on scoreboard.presets for insert with check (owner_id = auth.uid());
create policy presets_update on scoreboard.presets for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy presets_delete on scoreboard.presets for delete using (owner_id = auth.uid());

-- --------------------------------------------------------------- grants ----
grant select on scoreboard.games to anon;
grant select on scoreboard.events to anon;
grant select, insert, update, delete on scoreboard.games to authenticated;
grant select, insert, update, delete on scoreboard.events to authenticated;
grant select, insert, update, delete on scoreboard.rosters to authenticated;
grant select, insert, update, delete on scoreboard.teams to authenticated;
grant select, insert, update, delete on scoreboard.presets to authenticated;

-- ------------------------------------------------------------- realtime ----
-- How control -> Postgres -> overlay works at all.
alter publication supabase_realtime add table scoreboard.games;
alter publication supabase_realtime add table scoreboard.events;
