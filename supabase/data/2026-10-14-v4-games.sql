-- =============================================================================
-- One-off data move, run 2026-10-14: v4's games into v5. Kept for the record.
-- =============================================================================
-- Source: the v4 `scoreboard` schema in the same database. Target: Blue Steel
-- (the team brought over from Pressbox), season Fall 2026.
--
-- Afterwards the two new opponents' codes were shortened by hand (EXPR, LSTAR).
--
-- What comes over:
--   - every final baseball game, and every game still in setup that has not
--     started yet (the upcoming schedule). The one game v4 still shows as live
--     (9/23, Aubrey Thomas, stopped in the 1st) stays behind.
--   - the game row: opponent, home or away, start time, venue, and for a final
--     game the score, hits, errors, line score and closing state.
--   - both lineups. Our batters are matched to Blue Steel's roster by jersey
--     number, and so are Krum's when Krum (a team here) is the opponent; a
--     match takes the player's id as its bid, so the public pages show the
--     player under their own public-name setting.
--   - each play as a log entry (game_events, payload.source = 'v4'). v4 plays
--     named no one, so there are no per-player stat rows. The games still
--     count (counts_for_stats), so they are not labelled scrimmages; with no
--     stat rows they add nothing to the season lines.
--   - legacy_games: v4 id -> v5 id, for old recap links.
--   - opponents not yet remembered (Express, Lonestar), and Sanger Wolf's
--     newer v4 lineup.
-- Safe to run twice: a game already in legacy_games is skipped.
-- =============================================================================

create function pg_temp.v4_lineup(d jsonb, p_team uuid)
returns jsonb language sql stable as $$
  with b as (
    select e.b, e.o,
           (select p.id::text from public.players p
             where p_team is not null and p.team_id = p_team and p.number <> '' and p.number = e.b->>'num' limit 1) as pid
      from jsonb_array_elements(coalesce(d->'batters', '[]')) with ordinality e(b, o)
     where coalesce(e.b->>'num', '') <> '' or coalesce(e.b->>'name', '') <> ''
  ), m as (
    select b.*, coalesce(pid, nullif(b->>'bid', ''), 'v4b' || o) as nbid from b
  )
  select jsonb_build_object(
    'batters', coalesce((select jsonb_agg(jsonb_build_object('bid', nbid, 'num', coalesce(b->>'num', ''), 'name', coalesce(b->>'name', '')) order by o) from m), '[]'),
    'positions', coalesce((select jsonb_object_agg(k, coalesce((select m.nbid from m where m.b->>'bid' = v), v))
                             from jsonb_each_text(case when jsonb_typeof(d->'positions') = 'object' then d->'positions' else '{}' end) as x(k, v)), '{}'),
    'pitcher', coalesce(d->'pitcher', '{"num": "", "name": ""}'))
$$;

do $$
declare
  bs     constant uuid := '65ef3b9e-a6fe-4c6d-888c-88acde37d210';  -- Blue Steel
  krum   constant uuid := 'a83c46b3-8cca-447a-a017-978264c23ed0';  -- Krum, a team here too
  season constant uuid := 'b8f868cc-e795-4cf5-ad05-ec424cb5adc2';  -- Fall 2026
  owner  constant uuid := '3948a60d-322b-4324-954c-da5d3cd67766';
  r record;
  us_home boolean; opp_name text; opp_abbr text; opp_color text; opp_team uuid;
  v_game uuid; v_seq int; v_live jsonb;
begin
  for r in
    select g.*, ro.data as roster
      from scoreboard.games g left join scoreboard.rosters ro on ro.game_id = g.id
     where g.sport = 'baseball'
       and (g.status = 'final' or (g.status = 'setup' and g.starts_at > now()))
       and not exists (select 1 from public.legacy_games l where l.v4_id = g.id)
     order by g.starts_at
  loop
    us_home   := r.home_name ilike 'blue steel%';
    opp_name  := case when us_home then r.away_name else r.home_name end;
    opp_abbr  := left(upper(coalesce(nullif(trim(case when us_home then r.away_abbr else r.home_abbr end), ''), opp_name)), 6);
    opp_color := case when us_home then r.away_color else r.home_color end;
    if opp_color is null or opp_color !~ '^#[0-9a-fA-F]{6}$' then opp_color := '#7a8794'; end if;
    opp_team  := case when opp_name ilike 'krum%' then krum end;

    v_live := case when r.status = 'final' then jsonb_build_object(
      'inning', r.inning, 'half', r.half, 'balls', 0, 'strikes', 0, 'outs', r.outs, 'bases', r.bases,
      'home_score', r.home_score, 'away_score', r.away_score, 'home_hits', r.home_hits, 'away_hits', r.away_hits,
      'home_errors', r.home_errors, 'away_errors', r.away_errors, 'line_score', r.line_score, 'state', r.state)
      else '{}'::jsonb end;
    select count(*) into v_seq from scoreboard.plays p where p.game_id = r.id;

    insert into public.games (team_id, season_id, counts_for_stats, opponent_team_id, opponent_name, opponent_abbr,
                              opponent_color, is_home, starts_at, venue, status, live, seq, created_by, created_at, sport)
    values (bs, season, true, opp_team, left(opp_name, 60), opp_abbr, opp_color, us_home, r.starts_at,
            left(r.venue->>'label', 80), case when r.status = 'final' then 'final' else 'scheduled' end, v_live, v_seq,
            owner, r.created_at, 'baseball')
    returning id into v_game;

    insert into public.legacy_games (v4_id, game_id) values (r.id, v_game);

    if r.roster ? (case when us_home then 'home' else 'away' end) then
      insert into public.game_lineups (game_id, side, data)
      values (v_game, 'us', pg_temp.v4_lineup(r.roster->(case when us_home then 'home' else 'away' end), bs));
    end if;
    if r.roster ? (case when us_home then 'away' else 'home' end) then
      insert into public.game_lineups (game_id, side, data)
      values (v_game, 'them', pg_temp.v4_lineup(r.roster->(case when us_home then 'away' else 'home' end), opp_team));
    end if;

    insert into public.game_events (game_id, seq, type, payload, prev_live, prev_status, created_by, created_at)
    select v_game, row_number() over (order by p.event_id), left(p.kind, 24),
           jsonb_build_object('source', 'v4', 'play', jsonb_build_object(
             'kind', p.kind, 'code', p.code, 'pos', p.pos, 'inning', p.inning, 'half', p.half, 'outs', p.outs, 'runs', p.runs)),
           '{}'::jsonb, 'live', owner, p.created_at
      from scoreboard.plays p where p.game_id = r.id;
  end loop;

  -- Opponents remembered for New Game.
  insert into public.opponents (team_id, name, abbr, color, roster)
  select bs, left(g.home_name, 60), left(upper(g.home_abbr), 6), g.home_color, pg_temp.v4_lineup(ro.data->'home', null)
    from scoreboard.games g join scoreboard.rosters ro on ro.game_id = g.id
   where g.id = '10047dac-e0a9-43f1-b50f-c2b3bca9f11f'   -- The Express Baseball Club
  on conflict (team_id, lower(name)) do nothing;
  insert into public.opponents (team_id, name, abbr, color, roster)
  select bs, left(g.away_name, 60), left(upper(g.away_abbr), 6), g.away_color, pg_temp.v4_lineup(ro.data->'away', null)
    from scoreboard.games g join scoreboard.rosters ro on ro.game_id = g.id
   where g.id = 'f315dd57-5f0f-4ac3-8f1f-ea879a2c9723'   -- Lonestar Baseball Club DFW
  on conflict (team_id, lower(name)) do nothing;
  update public.opponents o set roster = pg_temp.v4_lineup(t.roster, null)
    from scoreboard.teams t
   where t.id = 'f484fba5-e66c-42de-b72a-968d28775e1e' and o.team_id = bs and lower(o.name) = 'sanger wolf';
end;
$$;

-- Afterwards (v5 stage 6): the venue's coordinates, for the weather, from v4's venue.
update public.games g set venue_geo = jsonb_build_object('label', o.venue->>'label', 'query', o.venue->>'query',
  'lat', (o.venue->>'lat')::numeric, 'lon', (o.venue->>'lon')::numeric, 'tz', o.venue->>'tz')
from public.legacy_games l join scoreboard.games o on o.id = l.v4_id
where l.game_id = g.id and o.venue ? 'lat';
