-- =============================================================================
-- v4's games, brought into v5.
-- =============================================================================
-- Scoreboard v4 kept its games in the `scoreboard` schema. Its plays named no
-- one (the public recap was name-free on purpose), so a v4 game comes over as
-- the game, its line score and both lineups, plus each play as a log entry:
-- no per-player stat rows, and it does not count for season stats.
--
-- legacy_games maps each v4 game id to its v5 game, so a v4 recap link
-- (/recap?game=<v4 id>) still lands on the game. Ids only; public, like the
-- games themselves.
--
-- public_game() gains `log`: an imported game's plays, in order, with the
-- inning, the half, what happened and the runs it scored. Games scored in v5
-- have no log entries; their plays come from `pas` as before.
-- =============================================================================

create table public.legacy_games (
  v4_id   uuid primary key,
  game_id uuid not null unique references public.games(id) on delete cascade
);
comment on table public.legacy_games is
  'v4 game id -> v5 game, so links from v4 (recaps) still land. Ids only.';

alter table public.legacy_games enable row level security;
create policy legacy_games_read on public.legacy_games for select using (true);
revoke all on public.legacy_games from anon, authenticated;
grant select on public.legacy_games to anon, authenticated;

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
