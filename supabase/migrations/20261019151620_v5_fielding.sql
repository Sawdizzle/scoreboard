-- =============================================================================
-- Fielding: who caught it, who threw it, who dropped it.
-- =============================================================================
-- A play now names its fielders in the order the ball went, the way the
-- scorebook writes it (a pickoff from the catcher to the third baseman is
-- 2-5, a double play 6-4-3), and each of them gets the scorebook's credit:
--
--   f_po   putout: the fielder who made the out (the catcher on a strikeout).
--   f_a    assist: each fielder who threw to the putout, once per play.
--   f_e    error.
--
-- The runner, the pitcher and the catcher keep what GameChanger keeps for them:
--
--   b_pik  times the runner was picked off.
--   p_pik  runners picked off while he was pitching.
--   c_sb   stolen bases allowed while he was catching.
--   c_cs   runners caught stealing while he was catching.
--   c_pik  runners he picked off himself (the catcher in a pickoff).
--   c_pb   passed balls.
--
-- Season stats add them like every other count, and a GameChanger export
-- brings its own fielding section into the same columns. Every new column
-- defaults to 0, so a pad that does not send them yet keeps working.
-- =============================================================================

alter table public.game_stats
  add column f_po  int not null default 0 check (f_po  between 0 and 3),
  add column f_a   int not null default 0 check (f_a   between 0 and 3),
  add column f_e   int not null default 0 check (f_e   between 0 and 3),
  add column p_pik int not null default 0 check (p_pik between 0 and 1),
  add column c_sb  int not null default 0 check (c_sb  between 0 and 1),
  add column c_cs  int not null default 0 check (c_cs  between 0 and 1),
  add column c_pik int not null default 0 check (c_pik between 0 and 1),
  add column c_pb  int not null default 0 check (c_pb  between 0 and 1),
  add column b_pik int not null default 0 check (b_pik between 0 and 1);

alter table public.stat_imports
  add column f_po  int not null default 0 check (f_po  >= 0),
  add column f_a   int not null default 0 check (f_a   >= 0),
  add column f_e   int not null default 0 check (f_e   >= 0),
  add column p_pik int not null default 0 check (p_pik >= 0),
  add column c_sb  int not null default 0 check (c_sb  >= 0),
  add column c_cs  int not null default 0 check (c_cs  >= 0),
  add column c_pik int not null default 0 check (c_pik >= 0),
  add column c_pb  int not null default 0 check (c_pb  >= 0),
  add column b_pik int not null default 0 check (b_pik >= 0);

-- Record one play, now with the fielders' credit. Unchanged otherwise, except
-- that a play may touch more people: the batter, the pitcher, three runners
-- and up to four fielders, so 16 rows rather than 8.
create or replace function public.apply_play(
  p_game uuid, p_seq int, p_type text, p_patch jsonb,
  p_payload jsonb default '{}', p_stats jsonb default '[]', p_status text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g public.games;
  v_patch jsonb;
  v_status text;
  v_event bigint;
begin
  select * into g from public.games where id = p_game for update;
  if g.id is null then
    raise exception 'That game does not exist.' using errcode = 'P0001';
  end if;
  if not public.has_team_role(g.team_id, array['organizer', 'head_coach', 'coach', 'scorer']) then
    raise exception 'Your seat cannot score this game.' using errcode = '42501';
  end if;
  if g.seq <> p_seq then
    raise exception 'This game changed on another device.' using errcode = 'PB409';
  end if;
  if jsonb_typeof(p_patch) <> 'object' or jsonb_typeof(p_stats) <> 'array' or jsonb_array_length(p_stats) > 16 then
    raise exception 'That play could not be read.' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('scheduled', 'live', 'final') then
    raise exception 'That play could not be read.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(k, v), '{}') into v_patch
    from jsonb_each(p_patch) as e(k, v) where k = any (public.live_keys());
  v_status := coalesce(p_status, case when g.status = 'scheduled' then 'live' else g.status end);

  insert into public.game_events (game_id, seq, type, payload, prev_live, prev_status)
  values (p_game, g.seq + 1, left(p_type, 24), coalesce(p_payload, '{}'), g.live, g.status)
  returning id into v_event;

  update public.games set live = g.live || v_patch, status = v_status, seq = g.seq + 1 where id = p_game;

  insert into public.game_stats (event_id, game_id, side, bid, player_id,
    b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_kl, b_hbp, b_sac, b_sf, b_roe, b_fc, b_sb, b_cs,
    p_outs, p_bf, p_pitches, p_h, p_r, p_er, p_bb, p_so, p_hbp, p_wp, p_bk,
    f_po, f_a, f_e, p_pik, c_sb, c_cs, c_pik, c_pb, b_pik)
  select v_event, p_game, r.side, r.bid,
    -- Our side's bids are player ids; keep one only if it is this team's player.
    case when r.side = 'us' then (select p.id from public.players p
                                   where p.team_id = g.team_id and p.id::text = r.bid) end,
    coalesce(r.b_pa, 0), coalesce(r.b_ab, 0), coalesce(r.b_h, 0), coalesce(r.b_2b, 0), coalesce(r.b_3b, 0),
    coalesce(r.b_hr, 0), coalesce(r.b_rbi, 0), coalesce(r.b_r, 0), coalesce(r.b_bb, 0), coalesce(r.b_so, 0),
    coalesce(r.b_kl, 0), coalesce(r.b_hbp, 0), coalesce(r.b_sac, 0), coalesce(r.b_sf, 0), coalesce(r.b_roe, 0),
    coalesce(r.b_fc, 0), coalesce(r.b_sb, 0), coalesce(r.b_cs, 0),
    coalesce(r.p_outs, 0), coalesce(r.p_bf, 0), coalesce(r.p_pitches, 0), coalesce(r.p_h, 0), coalesce(r.p_r, 0),
    coalesce(r.p_er, 0), coalesce(r.p_bb, 0), coalesce(r.p_so, 0), coalesce(r.p_hbp, 0), coalesce(r.p_wp, 0),
    coalesce(r.p_bk, 0),
    coalesce(r.f_po, 0), coalesce(r.f_a, 0), coalesce(r.f_e, 0), coalesce(r.p_pik, 0),
    coalesce(r.c_sb, 0), coalesce(r.c_cs, 0), coalesce(r.c_pik, 0), coalesce(r.c_pb, 0), coalesce(r.b_pik, 0)
  from jsonb_to_recordset(p_stats) as r(side text, bid text,
    b_pa int, b_ab int, b_h int, b_2b int, b_3b int, b_hr int, b_rbi int, b_r int, b_bb int, b_so int, b_kl int,
    b_hbp int, b_sac int, b_sf int, b_roe int, b_fc int, b_sb int, b_cs int,
    p_outs int, p_bf int, p_pitches int, p_h int, p_r int, p_er int, p_bb int, p_so int, p_hbp int, p_wp int, p_bk int,
    f_po int, f_a int, f_e int, p_pik int, c_sb int, c_cs int, c_pik int, c_pb int, b_pik int);

  return jsonb_build_object('seq', g.seq + 1, 'live', g.live || v_patch, 'status', v_status, 'event', v_event);
end;
$$;

-- A GameChanger import, now with its fielding section.
create or replace function public.import_season_stats(p_season uuid, p_rows jsonb)
returns int
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_team uuid;
  v_count int;
begin
  select team_id into v_team from public.seasons where id = p_season;
  if v_team is null then
    raise exception 'That season does not exist.' using errcode = 'P0001';
  end if;
  if not public.has_team_role(v_team, array['organizer', 'head_coach']) then
    raise exception 'Only an organizer or head coach can import stats.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then
    raise exception 'An import is a list of at most 60 players.' using errcode = 'P0001';
  end if;

  delete from public.stat_imports where season_id = p_season and source = 'gamechanger';

  insert into public.stat_imports (team_id, season_id, player_id, source,
    b_g, b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_kl, b_hbp, b_sac, b_sf, b_roe, b_fc, b_sb, b_cs,
    p_g, p_gs, p_outs, p_bf, p_pitches, p_w, p_l, p_sv, p_h, p_r, p_er, p_bb, p_so, p_hbp, p_wp, p_bk,
    f_po, f_a, f_e, p_pik, c_sb, c_cs, c_pik, c_pb, b_pik)
  select v_team, p_season, (r ->> 'player_id')::uuid, 'gamechanger',
    coalesce((r->>'b_g')::int, 0), coalesce((r->>'b_pa')::int, 0), coalesce((r->>'b_ab')::int, 0),
    coalesce((r->>'b_h')::int, 0), coalesce((r->>'b_2b')::int, 0), coalesce((r->>'b_3b')::int, 0),
    coalesce((r->>'b_hr')::int, 0), coalesce((r->>'b_rbi')::int, 0), coalesce((r->>'b_r')::int, 0),
    coalesce((r->>'b_bb')::int, 0), coalesce((r->>'b_so')::int, 0), coalesce((r->>'b_kl')::int, 0),
    coalesce((r->>'b_hbp')::int, 0), coalesce((r->>'b_sac')::int, 0), coalesce((r->>'b_sf')::int, 0),
    coalesce((r->>'b_roe')::int, 0), coalesce((r->>'b_fc')::int, 0), coalesce((r->>'b_sb')::int, 0),
    coalesce((r->>'b_cs')::int, 0),
    coalesce((r->>'p_g')::int, 0), coalesce((r->>'p_gs')::int, 0), coalesce((r->>'p_outs')::int, 0),
    coalesce((r->>'p_bf')::int, 0), coalesce((r->>'p_pitches')::int, 0), coalesce((r->>'p_w')::int, 0),
    coalesce((r->>'p_l')::int, 0), coalesce((r->>'p_sv')::int, 0), coalesce((r->>'p_h')::int, 0),
    coalesce((r->>'p_r')::int, 0), coalesce((r->>'p_er')::int, 0), coalesce((r->>'p_bb')::int, 0),
    coalesce((r->>'p_so')::int, 0), coalesce((r->>'p_hbp')::int, 0), coalesce((r->>'p_wp')::int, 0),
    coalesce((r->>'p_bk')::int, 0),
    coalesce((r->>'f_po')::int, 0), coalesce((r->>'f_a')::int, 0), coalesce((r->>'f_e')::int, 0),
    coalesce((r->>'p_pik')::int, 0), coalesce((r->>'c_sb')::int, 0), coalesce((r->>'c_cs')::int, 0),
    coalesce((r->>'c_pik')::int, 0), coalesce((r->>'c_pb')::int, 0), coalesce((r->>'b_pik')::int, 0)
  from jsonb_array_elements(p_rows) r;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Season stats: the same columns in the same order, the fielding ones after.
create or replace view public.season_stats with (security_invoker = true) as
with per_game as (
  select g.team_id, g.season_id, s.player_id, s.game_id,
         sum(s.b_pa) b_pa, sum(s.b_ab) b_ab, sum(s.b_h) b_h, sum(s.b_2b) b_2b, sum(s.b_3b) b_3b, sum(s.b_hr) b_hr,
         sum(s.b_rbi) b_rbi, sum(s.b_r) b_r, sum(s.b_bb) b_bb, sum(s.b_so) b_so, sum(s.b_kl) b_kl, sum(s.b_hbp) b_hbp,
         sum(s.b_sac) b_sac, sum(s.b_sf) b_sf, sum(s.b_roe) b_roe, sum(s.b_fc) b_fc, sum(s.b_sb) b_sb, sum(s.b_cs) b_cs,
         sum(s.p_outs) p_outs, sum(s.p_bf) p_bf, sum(s.p_pitches) p_pitches, sum(s.p_h) p_h, sum(s.p_r) p_r,
         sum(s.p_er) p_er, sum(s.p_bb) p_bb, sum(s.p_so) p_so, sum(s.p_hbp) p_hbp, sum(s.p_wp) p_wp, sum(s.p_bk) p_bk,
         coalesce(max(d.p_gs), 0) p_gs, coalesce(max(d.p_w), 0) p_w, coalesce(max(d.p_l), 0) p_l, coalesce(max(d.p_sv), 0) p_sv,
         sum(s.f_po) f_po, sum(s.f_a) f_a, sum(s.f_e) f_e, sum(s.p_pik) p_pik,
         sum(s.c_sb) c_sb, sum(s.c_cs) c_cs, sum(s.c_pik) c_pik, sum(s.c_pb) c_pb, sum(s.b_pik) b_pik
    from public.game_stats s
    join public.games g on g.id = s.game_id
    left join public.game_decisions d on d.game_id = s.game_id and d.player_id = s.player_id
   where s.side = 'us' and s.player_id is not null and g.counts_for_stats and g.season_id is not null
   group by g.team_id, g.season_id, s.player_id, s.game_id
),
scored as (
  select team_id, season_id, player_id,
         count(*) filter (where b_pa > 0) b_g, sum(b_pa) b_pa, sum(b_ab) b_ab, sum(b_h) b_h, sum(b_2b) b_2b,
         sum(b_3b) b_3b, sum(b_hr) b_hr, sum(b_rbi) b_rbi, sum(b_r) b_r, sum(b_bb) b_bb, sum(b_so) b_so,
         sum(b_kl) b_kl, sum(b_hbp) b_hbp, sum(b_sac) b_sac, sum(b_sf) b_sf, sum(b_roe) b_roe, sum(b_fc) b_fc,
         sum(b_sb) b_sb, sum(b_cs) b_cs,
         count(*) filter (where p_bf > 0 or p_outs > 0) p_g, sum(p_gs) p_gs, sum(p_outs) p_outs, sum(p_bf) p_bf,
         sum(p_pitches) p_pitches, sum(p_w) p_w, sum(p_l) p_l, sum(p_sv) p_sv, sum(p_h) p_h, sum(p_r) p_r, sum(p_er) p_er, sum(p_bb) p_bb,
         sum(p_so) p_so, sum(p_hbp) p_hbp, sum(p_wp) p_wp, sum(p_bk) p_bk,
         null::timestamptz imported_at,
         sum(f_po) f_po, sum(f_a) f_a, sum(f_e) f_e, sum(p_pik) p_pik,
         sum(c_sb) c_sb, sum(c_cs) c_cs, sum(c_pik) c_pik, sum(c_pb) c_pb, sum(b_pik) b_pik
    from per_game
   group by team_id, season_id, player_id
),
every_source as (
  select team_id, season_id, player_id,
         b_g, b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_kl, b_hbp, b_sac, b_sf, b_roe, b_fc, b_sb, b_cs,
         p_g, p_gs, p_outs, p_bf, p_pitches, p_w, p_l, p_sv, p_h, p_r, p_er, p_bb, p_so, p_hbp, p_wp, p_bk, imported_at,
         f_po, f_a, f_e, p_pik, c_sb, c_cs, c_pik, c_pb, b_pik
    from public.stat_imports
  union all
  select * from scored
)
select team_id, season_id, player_id,
       sum(b_g)::int b_g, sum(b_pa)::int b_pa, sum(b_ab)::int b_ab, sum(b_h)::int b_h, sum(b_2b)::int b_2b, sum(b_3b)::int b_3b,
       sum(b_hr)::int b_hr, sum(b_rbi)::int b_rbi, sum(b_r)::int b_r, sum(b_bb)::int b_bb, sum(b_so)::int b_so, sum(b_kl)::int b_kl,
       sum(b_hbp)::int b_hbp, sum(b_sac)::int b_sac, sum(b_sf)::int b_sf, sum(b_roe)::int b_roe, sum(b_fc)::int b_fc,
       sum(b_sb)::int b_sb, sum(b_cs)::int b_cs,
       sum(p_g)::int p_g, sum(p_gs)::int p_gs, sum(p_outs)::int p_outs, sum(p_bf)::int p_bf, sum(p_pitches)::int p_pitches,
       sum(p_w)::int p_w, sum(p_l)::int p_l, sum(p_sv)::int p_sv, sum(p_h)::int p_h, sum(p_r)::int p_r, sum(p_er)::int p_er,
       sum(p_bb)::int p_bb, sum(p_so)::int p_so, sum(p_hbp)::int p_hbp, sum(p_wp)::int p_wp, sum(p_bk)::int p_bk,
       max(imported_at) imported_at,
       sum(f_po)::int f_po, sum(f_a)::int f_a, sum(f_e)::int f_e, sum(p_pik)::int p_pik,
       sum(c_sb)::int c_sb, sum(c_cs)::int c_cs, sum(c_pik)::int c_pik, sum(c_pb)::int c_pb, sum(b_pik)::int b_pik
  from every_source
 group by team_id, season_id, player_id;
