-- =============================================================================
-- The scorebug's feed without season stats on every pitch.
-- =============================================================================
-- overlay_feed rebuilt season_stats (every game of the season, both teams)
-- each time the game moved, and the overlay asks for the feed every 2.5 s.
-- Season lines change slowly, so they move to their own call:
--
--   overlay_feed     unchanged, except season_stats is always [] now.
--   overlay_season   the season lines for the game the channel shows: ours
--                    for the game's season, and the other side's current
--                    season when they are a team here. The overlay asks for
--                    it when the game, the half inning or the status changes.
--
-- Same token rule as overlay_feed: the link's token is the only key.
-- =============================================================================

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
  so  public.opponents;
  ev  public.game_events;
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
             (select extract(epoch from max(updated_at)) from public.game_lineups where game_id = g.id),
             (select extract(epoch from o.updated_at) from public.opponents o where o.id = g.opponent_id));
  if p_have is not null and p_have = v_ver then
    return jsonb_build_object('v', v_ver);
  end if;

  if g.id is null then
    return jsonb_build_object('v', v_ver, 'game', null, 'broadcast', ch.broadcast, 'cmd', ch.cmd);
  end if;

  select * into opp from public.teams where id = g.opponent_team_id;
  select * into so from public.opponents where id = g.opponent_id;
  select * into sn from public.seasons where id = g.season_id;
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
      -- An opponent from the team's own list brings its current name, colors and logo.
      when so.id is not null
      then jsonb_build_object('name', so.name, 'display_name', so.name, 'abbr', so.abbr, 'color', so.color,
                              'color2', so.color2, 'logo_url', so.logo_url, 'age_group', null)
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
    -- Season lines now come from overlay_season(), once per half inning, not
    -- on every pitch. An empty list keeps a page still running older code
    -- drawing until its release check reloads it.
    'season_stats', '[]'::jsonb);
end;
$$;

create function public.overlay_season(p_token uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  ch  public.channels;
  g   public.games;
  v_opp_season uuid;
begin
  select * into ch from public.channels where token = p_token;
  if ch.team_id is null then
    return null;
  end if;
  -- The same game overlay_feed picks.
  select * into g from public.games where id = ch.game_id;
  if g.id is null then
    select * into g from public.games where team_id = ch.team_id and status <> 'final'
     order by (status = 'live') desc, starts_at asc nulls last limit 1;
  end if;
  if g.id is null then
    return jsonb_build_object('game', null, 'season_stats', '[]'::jsonb);
  end if;
  select id into v_opp_season from public.seasons where team_id = g.opponent_team_id and is_current;
  return jsonb_build_object(
    'game', g.id,
    'season_stats', coalesce((select jsonb_agg(to_jsonb(x)) from (
      select ss.* from public.season_stats ss
       where (ss.team_id = g.team_id and ss.season_id = g.season_id)
          or (ss.team_id = g.opponent_team_id and ss.season_id = v_opp_season)) x), '[]'::jsonb));
end;
$$;

revoke all on function public.overlay_season(uuid) from public;
grant execute on function public.overlay_season(uuid) to anon, authenticated;
