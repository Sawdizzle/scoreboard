-- =============================================================================
-- Stage 4 — public: a game as anyone may see it.
-- =============================================================================
-- Teams, seasons, games, per-play stats and season stats are already readable
-- without an account, and public_roster() gives a roster under each player's
-- public name. What the public side still lacked is a game's people: lineups
-- are staff-only, and so is the play log.
--
-- public_game(game) is that one read: the game, both lineups, tonight's line
-- for each player and each plate appearance. Names follow two rules:
--   - a player on a roster here is shown under their public-name setting;
--   - a player typed in at the field (the other side, when it is not a team
--     here) is shown by number only. The stream may name him, since the
--     scorer chose to put him on it; a public page does not.
-- =============================================================================

-- lineup_public gains that switch. Same function, one more argument.
drop function public.lineup_public(jsonb, uuid);
create function public.lineup_public(p_data jsonb, p_team uuid, p_guest_names boolean default true)
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
               'name', case when p.id is not null then coalesce(public.player_public_name(p), '')
                            when p_guest_names then coalesce(e.b->>'name', '')
                            else '' end)
             order by e.o)
        from jsonb_array_elements(case when jsonb_typeof(p_data->'batters') = 'array' then p_data->'batters' else '[]'::jsonb end)
             with ordinality as e(b, o)
        left join public.players p on p.team_id = p_team and p.id::text = e.b->>'bid'
    ), '[]'::jsonb));
$$;

-- p_have works as in overlay_feed: a page that is up to date gets only the
-- version back.
create function public.public_game(p_game uuid, p_have text default null)
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
    'game', jsonb_build_object('id', g.id, 'is_home', g.is_home, 'status', g.status, 'seq', g.seq, 'live', g.live,
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

revoke all on function public.lineup_public(jsonb, uuid, boolean) from public, anon, authenticated;
revoke all on function public.public_game(uuid, text) from public;
grant execute on function public.public_game(uuid, text) to anon, authenticated;
