-- =============================================================================
-- Stage 3a — on air: the stream link, and what the scorebug page reads.
-- =============================================================================
-- Each team has one channel: a secret link that goes into OBS (or any
-- streaming software) as a Browser Source, and what that page is showing.
--
--   token      the secret in the link. Whoever has it can watch the feed; it
--              is never listed, and only staff can read their own.
--   game_id    the game on the stream. It follows the pad: scoring a play
--              points the channel at that game. Staff can also point it by
--              hand, to put a game up before its first pitch.
--   show_line  the batter's season average and tonight's line on the scorebug.
--   auto_card  pop the batter card for each new batter.
--   card       the stat card held on air by hand, or null.
--
-- The scorebug page has no account (OBS cannot sign in), so it reads through
-- overlay_feed(token): the game, both lineups, tonight's stats and the season
-- lines, in one call. Lineups are staff-only everywhere else; the feed gives
-- our players under each one's public-name setting, never the roster's own.
-- =============================================================================

create table public.channels (
  team_id    uuid primary key references public.teams(id) on delete cascade,
  token      uuid not null unique default gen_random_uuid(),
  game_id    uuid references public.games(id) on delete set null,
  show_line  boolean not null default true,
  auto_card  boolean not null default false,
  card       text check (card in ('batter', 'pitcher', 'dueup')),
  updated_at timestamptz not null default now()
);
comment on table public.channels is
  'One per team: the secret Browser Source link and what the stream is showing. Staff only; the page reads through overlay_feed().';

-- Every team has a channel from the start.
insert into public.channels (team_id) select id from public.teams;

create function public.teams_channel()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.channels (team_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger teams_channel after insert on public.teams
  for each row execute function public.teams_channel();

-- The game on the stream has to be this team's game.
create function public.channels_check()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.game_id is not null
     and not exists (select 1 from public.games where id = new.game_id and team_id = new.team_id) then
    raise exception 'That game is not this team''s.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger channels_check before insert or update on public.channels
  for each row execute function public.channels_check();

-- The stream follows the pad: a play (or an undo) in a game puts that game on
-- the team's channel.
create function public.games_on_air()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.channels set game_id = new.id
   where team_id = new.team_id and game_id is distinct from new.id;
  return new;
end;
$$;
create trigger games_on_air after update of seq on public.games
  for each row when (new.seq is distinct from old.seq) execute function public.games_on_air();

-- ------------------------------------------------------------- the feed ----
-- A player's name as the public may see it (the same rule as public_roster).
create function public.player_public_name(p public.players)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case p.public_name
           when 'full' then nullif(trim(p.first_name || ' ' || p.last_name), '')
           when 'first_initial' then nullif(trim(p.first_name || ' ' ||
                  case when p.last_name <> '' then left(p.last_name, 1) || '.' else '' end), '')
           else null
         end;
$$;

-- A lineup as the stream may show it: the batting order and the positions.
-- A batter who is on p_team's roster is shown by number and public name; one
-- typed in at the field is shown as typed.
create function public.lineup_public(p_data jsonb, p_team uuid)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'positions', case when jsonb_typeof(p_data->'positions') = 'object' then p_data->'positions' else '{}'::jsonb end,
    'batters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'bid', e.b->>'bid',
               'num', case when p.id is null then coalesce(e.b->>'num', '') else p.number end,
               'name', case when p.id is null then coalesce(e.b->>'name', '') else coalesce(public.player_public_name(p), '') end)
             order by e.o)
        from jsonb_array_elements(case when jsonb_typeof(p_data->'batters') = 'array' then p_data->'batters' else '[]'::jsonb end)
             with ordinality as e(b, o)
        left join public.players p on p.team_id = p_team and p.id::text = e.b->>'bid'
    ), '[]'::jsonb));
$$;

-- Everything the scorebug page needs, by the channel's token. p_have is the
-- version the page already holds: when nothing has changed since, only the
-- version comes back, so a page polling through a three-hour stream costs
-- next to nothing.
create function public.overlay_feed(p_token uuid, p_have text default null)
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
    return jsonb_build_object('v', v_ver, 'game', null);
  end if;

  select * into opp from public.teams where id = g.opponent_team_id;
  select * into sn from public.seasons where id = g.season_id;
  select id into v_opp_season from public.seasons where team_id = g.opponent_team_id and is_current;

  return jsonb_build_object(
    'v', v_ver,
    'show_line', ch.show_line, 'auto_card', ch.auto_card, 'card', ch.card,
    'team', jsonb_build_object('name', t.name, 'display_name', t.display_name, 'color', t.color, 'color2', t.color2,
                               'logo_url', t.logo_url, 'age_group', t.age_group),
    'opponent', case when opp.id is not null
      then jsonb_build_object('name', opp.name, 'display_name', opp.display_name, 'color', opp.color, 'color2', opp.color2,
                              'logo_url', opp.logo_url, 'age_group', opp.age_group)
      else jsonb_build_object('name', g.opponent_name, 'display_name', g.opponent_name, 'color', g.opponent_color,
                              'color2', '#f2f6fc', 'logo_url', null, 'age_group', null) end,
    'game', jsonb_build_object('id', g.id, 'is_home', g.is_home, 'status', g.status, 'seq', g.seq, 'live', g.live),
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

-- ------------------------------------------------------------------- RLS ----
alter table public.channels enable row level security;

-- Any seat can see and run its team's stream: media is on the staff to do this.
create policy channels_read on public.channels for select
  using (public.is_team_staff(team_id));
create policy channels_update on public.channels for update
  using (public.is_team_staff(team_id)) with check (public.is_team_staff(team_id));

revoke all on public.channels from anon, authenticated;
grant select on public.channels to authenticated;
grant update (game_id, show_line, auto_card, card) on public.channels to authenticated;

revoke all on function public.teams_channel()  from public, anon, authenticated;
revoke all on function public.channels_check() from public, anon, authenticated;
revoke all on function public.games_on_air()   from public, anon, authenticated;
revoke all on function public.player_public_name(public.players) from public, anon, authenticated;
revoke all on function public.lineup_public(jsonb, uuid)         from public, anon, authenticated;
revoke all on function public.overlay_feed(uuid, text) from public;
grant execute on function public.overlay_feed(uuid, text) to anon, authenticated;
