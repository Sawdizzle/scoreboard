-- =============================================================================
-- What the public sees of a team's kids: less by default, nothing if private.
-- =============================================================================
-- Names
--   A new player, and a new team, start as "Alex R." (first_initial), not the
--   full name. Players already set to full are moved to first_initial; a
--   coach can set a player back to full on the player screen.
--
-- Private team
--   teams.private turns the public side of a team off. Anyone who is not on
--   the team's staff (anon, or a signed-in stranger) then gets no seasons,
--   games, stats, decisions, recaps or roster, and player_public_name() names
--   nobody (so an opponent's public game page and stream show numbers only).
--   The team row itself (name, colours, logo) stays readable, so the public
--   page can say the team is private. The stream overlay is unaffected: it is
--   reached by the channel's secret token, not by anyone browsing.
--
-- Where a game is
--   The street address and coordinates of a game place identified kids at a
--   time and place. anon no longer reads games.address or games.venue_geo,
--   and public_game() returns them only once the game is final (or to the
--   team's own staff).
--
-- Guests and opponents on public screens
--   A batter who is not one of the team's own players (a typed-in opponent,
--   a guest player, or a player since deleted) is shown by number only on
--   the stream and the public game page. An opponent that is a team here
--   still shows its players under its own name settings.
-- =============================================================================

-- ----------------------------------------------------------------- names ----
alter table public.players alter column public_name set default 'first_initial';
alter table public.teams alter column name_format set default 'first_initial';
update public.players set public_name = 'first_initial' where public_name = 'full';

-- ------------------------------------------------------------ private team --
alter table public.teams add column private boolean not null default false;
comment on column public.teams.private is
  'True hides the team''s roster, games and stats from everyone who is not on its staff.';
grant update (private) on public.teams to authenticated;

-- Whether the caller may see a team's public side: it is not private, or the
-- caller is on its staff.
create function public.team_visible(p_team uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select not t.private from public.teams t where t.id = p_team), false)
      or public.is_team_staff(p_team);
$$;

create function public.game_visible(p_game uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.team_visible((select g.team_id from public.games g where g.id = p_game));
$$;

revoke all on function public.team_visible(uuid) from public;
revoke all on function public.game_visible(uuid) from public;
grant execute on function public.team_visible(uuid) to anon, authenticated;
grant execute on function public.game_visible(uuid) to anon, authenticated;

alter policy seasons_read on public.seasons using (public.team_visible(team_id));
alter policy games_read on public.games using (public.team_visible(team_id));
alter policy game_stats_read on public.game_stats using (public.game_visible(game_id));
alter policy stat_imports_read on public.stat_imports using (public.team_visible(team_id));
alter policy game_decisions_read on public.game_decisions using (public.game_visible(game_id));
alter policy legacy_games_read on public.legacy_games using (public.game_visible(game_id));
alter policy game_recaps_read_public on public.game_recaps
  using (status = 'published' and public.team_visible(team_id));
alter policy game_recaps_read on public.game_recaps
  using ((status = 'published' and public.team_visible(team_id)) or public.is_team_staff(team_id));

-- A player's name as the public may see it: nobody's, on a private team.
create or replace function public.player_public_name(p public.players)
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select case
           when t.private then null
           when p.public_name = 'number' then null
           when p.public_name = 'first_initial' then public.format_name(p.first_name, p.last_name,
                  case when t.name_format in ('first', 'first_initial') then t.name_format else 'first_initial' end)
           else public.format_name(p.first_name, p.last_name, coalesce(t.name_format, 'full'))
         end
    from (select (select name_format from public.teams where id = p.team_id) as name_format,
                 coalesce((select private from public.teams where id = p.team_id), false) as private) t;
$$;

create or replace function public.public_roster(p_team uuid)
returns table (id uuid, number text, display_name text, positions text[], bats text, throws text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.number, public.player_public_name(p), p.positions, p.bats, p.throws
    from public.players p
   where p.team_id = p_team and p.active and public.team_visible(p_team)
   order by nullif(p.number, '')::int nulls last, p.last_name, p.first_name;
$$;

-- -------------------------------------------- guests: numbers only, always --
-- p_guest_names is kept so existing callers resolve; it no longer names anyone.
create or replace function public.lineup_public(p_data jsonb, p_team uuid, p_guest_names boolean default true)
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
               'name', case when p.id is not null then coalesce(public.player_public_name(p), '') else '' end)
             order by e.o)
        from jsonb_array_elements(case when jsonb_typeof(p_data->'batters') = 'array' then p_data->'batters' else '[]'::jsonb end)
             with ordinality as e(b, o)
        left join public.players p on p.team_id = p_team and p.id::text = e.b->>'bid'
    ), '[]'::jsonb));
$$;

-- ----------------------------------------------------------- game place ----
-- anon reads every games column except where the game is.
revoke select on public.games from anon;
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'games' and column_name not in ('address', 'venue_geo');
  execute format('grant select (%s) on public.games to anon', cols);
end $$;

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
  so  public.opponents;
  v_ver text;
  v_place boolean;
begin
  select * into g from public.games where id = p_game;
  if g.id is null or not public.team_visible(g.team_id) then
    return null;
  end if;
  v_ver := concat_ws(':', g.seq, extract(epoch from g.updated_at),
             (select extract(epoch from max(updated_at)) from public.game_lineups where game_id = g.id),
             (select extract(epoch from o.updated_at) from public.opponents o where o.id = g.opponent_id));
  if p_have is not null and p_have = v_ver then
    return jsonb_build_object('v', v_ver);
  end if;
  -- The street address and coordinates: after the game, or for the team's staff.
  v_place := g.status = 'final' or public.is_team_staff(g.team_id);

  select * into t from public.teams where id = g.team_id;
  select * into opp from public.teams where id = g.opponent_team_id;
  select * into so from public.opponents where id = g.opponent_id;
  select * into sn from public.seasons where id = g.season_id;

  return jsonb_build_object(
    'v', v_ver,
    'team', jsonb_build_object('slug', t.slug, 'name', t.name, 'display_name', t.display_name, 'abbr', t.abbr, 'color', t.color,
                               'color2', t.color2, 'logo_url', t.logo_url, 'age_group', t.age_group),
    'opponent', case when opp.id is not null
      then jsonb_build_object('slug', opp.slug, 'name', opp.name, 'display_name', opp.display_name, 'abbr', opp.abbr, 'color', opp.color,
                              'color2', opp.color2, 'logo_url', opp.logo_url, 'age_group', opp.age_group)
      -- An opponent from the team's own list brings its current name, colours and logo.
      when so.id is not null
      then jsonb_build_object('slug', null, 'name', so.name, 'display_name', so.name, 'abbr', so.abbr, 'color', so.color,
                              'color2', so.color2, 'logo_url', so.logo_url, 'age_group', null)
      else jsonb_build_object('slug', null, 'name', g.opponent_name, 'display_name', g.opponent_name, 'abbr', g.opponent_abbr,
                              'color', g.opponent_color, 'color2', '#f2f6fc', 'logo_url', null, 'age_group', null) end,
    'game', jsonb_build_object('id', g.id, 'sport', g.sport, 'is_home', g.is_home, 'status', g.status, 'seq', g.seq, 'live', g.live,
                               'starts_at', g.starts_at, 'venue', g.venue, 'counts_for_stats', g.counts_for_stats,
                               'address', case when v_place then g.address end, 'tournament_url', g.tournament_url,
                               'venue_geo', case when v_place then g.venue_geo end),
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
       where s.game_id = g.id and s.b_pa = 1), '[]'::jsonb),
    -- An imported (v4) game's plays. Its log entries carry source 'v4'.
    'log', coalesce((select jsonb_agg(jsonb_build_object(
               'inning', (e.payload->'play'->>'inning')::int, 'half', e.payload->'play'->>'half',
               'kind', e.payload->'play'->>'kind', 'code', e.payload->'play'->>'code',
               'runs', coalesce((e.payload->'play'->>'runs')::int, 0)) order by e.seq)
        from public.game_events e
       where e.game_id = g.id and e.payload->>'source' = 'v4'), '[]'::jsonb));
end;
$$;
