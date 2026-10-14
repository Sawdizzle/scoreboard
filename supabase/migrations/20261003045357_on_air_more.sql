-- =============================================================================
-- Extras 2 — more of On Air: five more cards, a sponsor, mid-inning by
-- itself, and a new stream link when the old one has got out.
-- =============================================================================
-- Cards: the batting order (lineup), the fielders (defense), batter against
-- pitcher (matchup), the sponsor, and the mid-inning board (line score and
-- who is due up). auto_mid puts the mid-inning board up by itself between
-- halves, until the next pitch.
--
-- The sponsor is a name, a line under it and a logo, set by the team's leads.
--
-- reset_stream_link() gives the channel a new token: the old Browser Source
-- link stops working at once. Organizer or head coach only.
--
-- Both feeds are replaced to carry the game's sport; the stream's also carries
-- the sponsor, auto_mid, and whether the newest play ended a half.
-- =============================================================================

alter table public.channels
  add column auto_mid     boolean not null default false,
  add column sponsor_name text check (sponsor_name is null or char_length(sponsor_name) between 1 and 40),
  add column sponsor_line text check (sponsor_line is null or char_length(sponsor_line) <= 60),
  add column sponsor_logo text check (sponsor_logo is null or (sponsor_logo ~ '^https://' and char_length(sponsor_logo) <= 500));

alter table public.channels drop constraint channels_card_check;
alter table public.channels add constraint channels_card_check
  check (card in ('batter', 'pitcher', 'dueup', 'leaders', 'box', 'lineup', 'defense', 'matchup', 'sponsor', 'mid'));

grant update (auto_mid) on public.channels to authenticated;

-- The sponsor is the team's, not the night's: its leads set it.
create function public.set_sponsor(p_team uuid, p_name text, p_line text, p_logo text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_team_role(p_team, array['organizer', 'head_coach']) then
    raise exception 'Only an organizer or head coach can set the sponsor.' using errcode = '42501';
  end if;
  update public.channels
     set sponsor_name = nullif(trim(p_name), ''), sponsor_line = nullif(trim(p_line), ''), sponsor_logo = nullif(trim(p_logo), ''),
         card = case when nullif(trim(p_name), '') is null and card = 'sponsor' then null else card end
   where team_id = p_team;
end;
$$;

create function public.reset_stream_link(p_team uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  if not public.has_team_role(p_team, array['organizer', 'head_coach']) then
    raise exception 'Only an organizer or head coach can change the stream link.' using errcode = '42501';
  end if;
  update public.channels set token = gen_random_uuid() where team_id = p_team returning token into v_token;
  return v_token;
end;
$$;

revoke all on function public.set_sponsor(uuid, text, text, text) from public, anon;
revoke all on function public.reset_stream_link(uuid) from public, anon;
grant execute on function public.set_sponsor(uuid, text, text, text) to authenticated;
grant execute on function public.reset_stream_link(uuid) to authenticated;

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
    return jsonb_build_object('v', v_ver, 'game', null);
  end if;

  select * into opp from public.teams where id = g.opponent_team_id;
  select * into sn from public.seasons where id = g.season_id;
  select id into v_opp_season from public.seasons where team_id = g.opponent_team_id and is_current;
  select * into ev from public.game_events where game_id = g.id order by id desc limit 1;

  return jsonb_build_object(
    'v', v_ver,
    'show_line', ch.show_line, 'auto_card', ch.auto_card, 'auto_mid', ch.auto_mid, 'card', ch.card, 'look', ch.look,
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
    'game', jsonb_build_object('id', g.id, 'sport', g.sport, 'is_home', g.is_home, 'status', g.status, 'seq', g.seq, 'live', g.live),
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

create or replace function public.public_game(p_game uuid, p_have text default null)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  g   public.games;
  t   public.teams;
  opp public.teams;
  sn  public.seasons;
  v_ver text;
begin
  select * into g from public.games where id = p_game;
  if g.id is null then
    return null;
  end if;
  v_ver := concat_ws(':', g.seq, extract(epoch from g.updated_at),
             (select extract(epoch from max(updated_at)) from public.game_lineups where game_id = g.id));
  if p_have is not null and p_have = v_ver then
    return jsonb_build_object('v', v_ver);
  end if;

  select * into t from public.teams where id = g.team_id;
  select * into opp from public.teams where id = g.opponent_team_id;
  select * into sn from public.seasons where id = g.season_id;

  return jsonb_build_object(
    'v', v_ver,
    'team', jsonb_build_object('slug', t.slug, 'name', t.name, 'display_name', t.display_name, 'abbr', t.abbr, 'color', t.color,
                               'color2', t.color2, 'logo_url', t.logo_url, 'age_group', t.age_group),
    'opponent', case when opp.id is not null
      then jsonb_build_object('slug', opp.slug, 'name', opp.name, 'display_name', opp.display_name, 'abbr', opp.abbr, 'color', opp.color,
                              'color2', opp.color2, 'logo_url', opp.logo_url, 'age_group', opp.age_group)
      else jsonb_build_object('slug', null, 'name', g.opponent_name, 'display_name', g.opponent_name, 'abbr', g.opponent_abbr,
                              'color', g.opponent_color, 'color2', '#f2f6fc', 'logo_url', null, 'age_group', null) end,
    'game', jsonb_build_object('id', g.id, 'sport', g.sport, 'is_home', g.is_home, 'status', g.status, 'seq', g.seq, 'live', g.live,
                               'starts_at', g.starts_at, 'venue', g.venue, 'counts_for_stats', g.counts_for_stats),
    'season', case when sn.id is null then null
      else jsonb_build_object('name', sn.name, 'game_innings', sn.game_innings) end,
    'lineups', jsonb_build_object(
      'us', (select public.lineup_public(l.data, g.team_id, false) from public.game_lineups l where l.game_id = g.id and l.side = 'us'),
      'them', (select public.lineup_public(l.data, g.opponent_team_id, false) from public.game_lineups l where l.game_id = g.id and l.side = 'them')),
    'tonight', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select s.side, s.bid,
             sum(s.b_pa)::int b_pa, sum(s.b_ab)::int b_ab, sum(s.b_h)::int b_h, sum(s.b_2b)::int b_2b, sum(s.b_3b)::int b_3b,
             sum(s.b_hr)::int b_hr, sum(s.b_rbi)::int b_rbi, sum(s.b_r)::int b_r, sum(s.b_bb)::int b_bb, sum(s.b_so)::int b_so,
             sum(s.b_hbp)::int b_hbp, sum(s.b_sb)::int b_sb,
             sum(s.p_outs)::int p_outs, sum(s.p_bf)::int p_bf, sum(s.p_pitches)::int p_pitches, sum(s.p_h)::int p_h,
             sum(s.p_r)::int p_r, sum(s.p_er)::int p_er, sum(s.p_bb)::int p_bb, sum(s.p_so)::int p_so
        from public.game_stats s where s.game_id = g.id group by s.side, s.bid) x), '[]'::jsonb),
    'pas', coalesce((select jsonb_agg(jsonb_build_object(
               'side', s.side, 'bid', s.bid, 'inning', (e.payload->'play'->>'inning')::int,
               'kind', coalesce(e.payload->'play'->>'kind', e.type), 'code', e.payload->'play'->>'code',
               'rbi', s.b_rbi) order by e.seq)
        from public.game_stats s join public.game_events e on e.id = s.event_id
       where s.game_id = g.id and s.b_pa = 1), '[]'::jsonb));
end;
$$;
