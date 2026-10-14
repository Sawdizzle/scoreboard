-- =============================================================================
-- v5 broadcast: everything v4's broadcast did, in three places.
-- =============================================================================
-- games.clock      the game clock: { mode: 'down' | 'up', running, ends_at,
--                  remaining, base, since }. A countdown (baseball time limit,
--                  football and basketball quarters) runs to ends_at; soccer
--                  counts up from base + (now - since). Written by the pad as
--                  a plain update, not a play: starting a clock is not undone.
-- games.settings   per-game rules the pad and the stream read: time_limit (s),
--                  run_rule (runs), regulation (innings), period length ...
-- games.venue_geo  { lat, lon, tz, label } for the venue's weather.
--
-- channels.broadcast  how the stream looks and sounds, one object merged key
--                  by key through set_broadcast(): theme, style, custom colours,
--                  bug position, sound pack and levels, ticker, the scene up
--                  now (starting soon, final, paused), scene style, OBS
--                  options. The page reads it defensively.
-- channels.cmd     the last one-shot command: { type, ..., n }. n is a stamp;
--                  the stream acts on a command once, when n is new. Moments
--                  (walk-off, Charge!, rally), intros, replays, OBS actions.
-- channel_obs      what OBS reports back through the Browser Source (streaming,
--                  recording, scenes, the last replay), by the stream token. A
--                  table of its own, so a report every few seconds does not
--                  change the feed the stream polls.
--
-- reset_game() starts a game over: every play and its stats go, the game is
-- back to before the first pitch.
-- =============================================================================

alter table public.games
  add column clock     jsonb check (clock is null or (jsonb_typeof(clock) = 'object' and pg_column_size(clock) < 512)),
  add column settings  jsonb not null default '{}' check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 2048),
  add column venue_geo jsonb check (venue_geo is null or (jsonb_typeof(venue_geo) = 'object' and pg_column_size(venue_geo) < 512));
grant insert (settings, venue_geo) on public.games to authenticated;
grant update (clock, settings, venue_geo) on public.games to authenticated;

alter table public.channels
  add column broadcast jsonb not null default '{}' check (jsonb_typeof(broadcast) = 'object' and pg_column_size(broadcast) < 16384),
  add column cmd       jsonb check (cmd is null or (jsonb_typeof(cmd) = 'object' and pg_column_size(cmd) < 2048));
grant update (broadcast, cmd) on public.channels to authenticated;

create table public.channel_obs (
  team_id uuid primary key references public.teams(id) on delete cascade,
  obs     jsonb not null default '{}' check (jsonb_typeof(obs) = 'object' and pg_column_size(obs) < 16384),
  at      timestamptz not null default now()
);
alter table public.channel_obs enable row level security;
create policy channel_obs_read on public.channel_obs for select using (public.is_team_staff(team_id));
revoke all on public.channel_obs from anon, authenticated;
grant select on public.channel_obs to authenticated;

-- Merge keys into the broadcast settings; a key set to null is removed.
-- SECURITY INVOKER: the channels update policy (any seat) decides.
create function public.set_broadcast(p_team uuid, p_patch jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if jsonb_typeof(p_patch) <> 'object' then
    raise exception 'That setting could not be read.' using errcode = 'P0001';
  end if;
  update public.channels set broadcast = jsonb_strip_nulls(broadcast || p_patch)
   where team_id = p_team returning broadcast into v;
  if v is null then
    raise exception 'Your seat cannot run this stream.' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- Send a one-shot command to the stream, stamped so it plays once.
create function public.send_cmd(p_team uuid, p_cmd jsonb)
returns jsonb
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if jsonb_typeof(p_cmd) <> 'object' or coalesce(p_cmd->>'type', '') = '' then
    raise exception 'That command could not be read.' using errcode = 'P0001';
  end if;
  update public.channels
     set cmd = p_cmd || jsonb_build_object('n', floor(extract(epoch from clock_timestamp()) * 1000)::bigint)
   where team_id = p_team returning cmd into v;
  if v is null then
    raise exception 'Your seat cannot run this stream.' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- OBS reports back through the Browser Source, which has no account: the
-- stream token is the key, as it is for reading the feed.
create function public.obs_report(p_token uuid, p_obs jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_obs) <> 'object' or pg_column_size(p_obs) >= 16000 then return; end if;
  insert into public.channel_obs (team_id, obs, at)
  select c.team_id, p_obs, now() from public.channels c where c.token = p_token
  on conflict (team_id) do update set obs = excluded.obs, at = excluded.at;
end;
$$;

create function public.reset_game(p_game uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if g.id is null then
    raise exception 'That game does not exist.' using errcode = 'P0001';
  end if;
  if not public.has_team_role(g.team_id, array['organizer', 'head_coach', 'coach', 'scorer']) then
    raise exception 'Your seat cannot score this game.' using errcode = '42501';
  end if;
  delete from public.game_events where game_id = p_game;
  update public.games set live = '{}', status = 'scheduled', clock = null, seq = g.seq + 1 where id = p_game;
  return jsonb_build_object('seq', g.seq + 1, 'live', '{}'::jsonb, 'status', 'scheduled');
end;
$$;

revoke all on function public.set_broadcast(uuid, jsonb) from public, anon;
revoke all on function public.send_cmd(uuid, jsonb) from public, anon;
revoke all on function public.obs_report(uuid, jsonb) from public;
revoke all on function public.reset_game(uuid) from public, anon;
grant execute on function public.set_broadcast(uuid, jsonb) to authenticated;
grant execute on function public.send_cmd(uuid, jsonb) to authenticated;
grant execute on function public.obs_report(uuid, jsonb) to anon, authenticated;
grant execute on function public.reset_game(uuid) to authenticated;

create or replace function public.overlay_feed(p_token uuid, p_have text default null)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  ch  public.channels;
  t   public.teams;
  g   public.games;
  opp public.teams;
  sn  public.seasons;
  ev  public.game_events;
  v_opp_season uuid;
  v_ver text;
begin
  select * into ch from public.channels where token = p_token;
  if ch.team_id is null then
    return null;
  end if;
  select * into t from public.teams where id = ch.team_id;

  -- The game on the stream; before any has been scored, the one in play or
  -- coming up next.
  select * into g from public.games where id = ch.game_id;
  if g.id is null then
    select * into g from public.games where team_id = ch.team_id and status <> 'final'
     order by (status = 'live') desc, starts_at asc nulls last limit 1;
  end if;

  v_ver := concat_ws(':', g.id, g.seq, extract(epoch from g.updated_at), extract(epoch from ch.updated_at),
             (select extract(epoch from max(updated_at)) from public.game_lineups where game_id = g.id));
  if p_have is not null and p_have = v_ver then
    return jsonb_build_object('v', v_ver);
  end if;

  if g.id is null then
    return jsonb_build_object('v', v_ver, 'game', null, 'broadcast', ch.broadcast, 'cmd', ch.cmd);
  end if;

  select * into opp from public.teams where id = g.opponent_team_id;
  select * into sn from public.seasons where id = g.season_id;
  select id into v_opp_season from public.seasons where team_id = g.opponent_team_id and is_current;
  select * into ev from public.game_events where game_id = g.id order by id desc limit 1;

  return jsonb_build_object(
    'v', v_ver,
    'show_line', ch.show_line, 'auto_card', ch.auto_card, 'auto_mid', ch.auto_mid, 'card', ch.card, 'look', ch.look,
    -- The corner bug, and the last spot asked for (the page plays one when its stamp changes).
    'bug', case when ch.bug_text is not null or ch.bug_url is not null
      then jsonb_build_object('text', ch.bug_text, 'url', ch.bug_url) end,
    'spot', ch.spot,
    'qr', ch.qr,
    'layout', ch.layout,
    -- v5 broadcast: theme, layout style, sound, scenes, ticker ... and the
    -- last one-shot command (a moment, an intro, a replay), stamped with n.
    'broadcast', ch.broadcast,
    'cmd', ch.cmd,
    'sponsor', case when ch.sponsor_name is not null
      then jsonb_build_object('name', ch.sponsor_name, 'line', ch.sponsor_line, 'logo', ch.sponsor_logo) end,
    -- The play that made the game what it is now, for a look that animates
    -- it. After an undo the newest play is older than the game: no replay.
    'last', case when ev.id is not null and ev.seq = g.seq
      then jsonb_build_object('seq', ev.seq, 'type', ev.type, 'kind', ev.payload->'play'->>'kind',
             -- Whether that play ended a half: the stream's mid-inning card stands until the next one.
             'rolled', (ev.prev_live->>'half') is distinct from (g.live->>'half')
                    or (ev.prev_live->>'inning') is distinct from (g.live->>'inning')) end,
    -- Our roster under its public names, to put a name on a season leader.
    'roster', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'num', r.number, 'name', coalesce(r.display_name, '')))
                          from public.public_roster(g.team_id) r), '[]'::jsonb),
    'team', jsonb_build_object('name', t.name, 'display_name', t.display_name, 'abbr', t.abbr, 'color', t.color, 'color2', t.color2,
                               'logo_url', t.logo_url, 'age_group', t.age_group),
    'opponent', case when opp.id is not null
      then jsonb_build_object('name', opp.name, 'display_name', opp.display_name, 'abbr', opp.abbr, 'color', opp.color, 'color2', opp.color2,
                              'logo_url', opp.logo_url, 'age_group', opp.age_group)
      else jsonb_build_object('name', g.opponent_name, 'display_name', g.opponent_name, 'abbr', g.opponent_abbr, 'color', g.opponent_color,
                              'color2', '#f2f6fc', 'logo_url', null, 'age_group', null) end,
    'game', jsonb_build_object('id', g.id, 'sport', g.sport, 'is_home', g.is_home, 'status', g.status, 'seq', g.seq, 'live', g.live,
                               'clock', g.clock, 'settings', g.settings, 'starts_at', g.starts_at, 'venue', g.venue, 'venue_geo', g.venue_geo),
    'season', case when sn.id is null then null
      else jsonb_build_object('name', sn.name, 'game_innings', sn.game_innings) end,
    'lineups', jsonb_build_object(
      'us', (select public.lineup_public(l.data, g.team_id) from public.game_lineups l where l.game_id = g.id and l.side = 'us'),
      'them', (select public.lineup_public(l.data, g.opponent_team_id) from public.game_lineups l where l.game_id = g.id and l.side = 'them')),
    -- Tonight, one line per player.
    'tonight', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select s.side, s.bid,
             sum(s.b_pa)::int b_pa, sum(s.b_ab)::int b_ab, sum(s.b_h)::int b_h, sum(s.b_2b)::int b_2b, sum(s.b_3b)::int b_3b,
             sum(s.b_hr)::int b_hr, sum(s.b_rbi)::int b_rbi, sum(s.b_r)::int b_r, sum(s.b_bb)::int b_bb, sum(s.b_so)::int b_so,
             sum(s.b_hbp)::int b_hbp, sum(s.b_sb)::int b_sb,
             sum(s.p_outs)::int p_outs, sum(s.p_bf)::int p_bf, sum(s.p_pitches)::int p_pitches, sum(s.p_h)::int p_h,
             sum(s.p_r)::int p_r, sum(s.p_er)::int p_er, sum(s.p_bb)::int p_bb, sum(s.p_so)::int p_so
        from public.game_stats s where s.game_id = g.id group by s.side, s.bid) x), '[]'::jsonb),
    -- Each plate appearance so far, in order: who, which inning, what happened.
    'pas', coalesce((select jsonb_agg(jsonb_build_object(
               'side', s.side, 'bid', s.bid, 'inning', (e.payload->'play'->>'inning')::int,
               'kind', coalesce(e.payload->'play'->>'kind', e.type), 'code', e.payload->'play'->>'code') order by e.seq)
        from public.game_stats s join public.game_events e on e.id = s.event_id
       where s.game_id = g.id and s.b_pa = 1), '[]'::jsonb),
    -- Season lines: ours for this game's season, and the other side's own
    -- current season when they are a team here.
    'season_stats', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select ss.* from public.season_stats ss
       where (ss.team_id = g.team_id and ss.season_id = g.season_id)
          or (ss.team_id = g.opponent_team_id and ss.season_id = v_opp_season)) x), '[]'::jsonb));
end;
$$;
