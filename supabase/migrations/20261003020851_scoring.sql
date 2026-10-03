-- =============================================================================
-- Stage 2c — scoring: every play, who it was about, and what it added.
-- =============================================================================
-- The pad runs Scoreboard's rules (lib/rules) in the browser, as Scoreboard
-- does, and sends each play here as three things:
--
--   the patch     what the play changed in the game (count, outs, bases,
--                 score, line score, whose turn it is). Merged into games.live.
--   the payload   what the play was ({ play: { kind, pos, code, ... } }), for
--                 the log and, later, the play-by-play.
--   the stats     one row per player it touched: the batter's plate
--                 appearance, the pitcher's pitch and out, a runner's run or
--                 steal. Rows name players by id (`bid`), never by name.
--
-- apply_play writes all three in one transaction, with a snapshot of the game
-- as it was, so undo_play can put it back exactly and take the play's stats
-- with it. games.seq counts every change; a play sent against an older seq is
-- refused (another phone scored in between), and the pad reloads rather than
-- writing over it.
--
-- Season stats now add the two sources: GameChanger imports and games scored
-- here, for our side only, and only games that count. A game counts for the
-- team that scored it (PLAN.md, decision 2), never for the other side.
-- =============================================================================

alter table public.games add column seq int not null default 0;

create table public.game_events (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.games(id) on delete cascade,
  seq         int not null,
  type        text not null check (char_length(type) between 1 and 24),
  payload     jsonb not null default '{}',
  prev_live   jsonb not null,
  prev_status text not null,
  created_by  uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (game_id, seq)
);
comment on table public.game_events is
  'Every play the pad recorded, with the game as it stood before it, so a play can be undone exactly.';

create table public.game_stats (
  id        bigint generated always as identity primary key,
  event_id  bigint not null references public.game_events(id) on delete cascade,
  game_id   uuid not null references public.games(id) on delete cascade,
  side      text not null check (side in ('us', 'them')),
  bid       text not null check (char_length(bid) between 1 and 64),
  -- Set for our own players, so season stats can find them; null for the
  -- other side, whose players may be typed in at the field.
  player_id uuid references public.players(id) on delete set null,

  b_pa  int not null default 0 check (b_pa  between 0 and 1),
  b_ab  int not null default 0 check (b_ab  between 0 and 1),
  b_h   int not null default 0 check (b_h   between 0 and 1),
  b_2b  int not null default 0 check (b_2b  between 0 and 1),
  b_3b  int not null default 0 check (b_3b  between 0 and 1),
  b_hr  int not null default 0 check (b_hr  between 0 and 1),
  b_rbi int not null default 0 check (b_rbi between 0 and 4),
  b_r   int not null default 0 check (b_r   between 0 and 1),
  b_bb  int not null default 0 check (b_bb  between 0 and 1),
  b_so  int not null default 0 check (b_so  between 0 and 1),
  b_kl  int not null default 0 check (b_kl  between 0 and 1),
  b_hbp int not null default 0 check (b_hbp between 0 and 1),
  b_sac int not null default 0 check (b_sac between 0 and 1),
  b_sf  int not null default 0 check (b_sf  between 0 and 1),
  b_roe int not null default 0 check (b_roe between 0 and 1),
  b_fc  int not null default 0 check (b_fc  between 0 and 1),
  b_sb  int not null default 0 check (b_sb  between 0 and 1),
  b_cs  int not null default 0 check (b_cs  between 0 and 1),

  p_outs    int not null default 0 check (p_outs    between 0 and 3),
  p_bf      int not null default 0 check (p_bf      between 0 and 1),
  p_pitches int not null default 0 check (p_pitches between 0 and 1),
  p_h       int not null default 0 check (p_h       between 0 and 1),
  p_r       int not null default 0 check (p_r       between 0 and 4),
  p_er      int not null default 0 check (p_er      between 0 and 4),
  p_bb      int not null default 0 check (p_bb      between 0 and 1),
  p_so      int not null default 0 check (p_so      between 0 and 1),
  p_hbp     int not null default 0 check (p_hbp     between 0 and 1),
  p_wp      int not null default 0 check (p_wp      between 0 and 1),
  p_bk      int not null default 0 check (p_bk      between 0 and 1)
);
create index game_stats_game_idx on public.game_stats (game_id);
create index game_stats_player_idx on public.game_stats (player_id);
create index game_stats_event_idx on public.game_stats (event_id);
comment on table public.game_stats is
  'What one play added to one player. Summed per game for a box score, per season (our side, counting games) for season stats.';

-- The fields of games.live a play may change. Anything else in a patch is
-- dropped: live is public, and nothing but the game belongs on it.
create function public.live_keys()
returns text[]
language sql immutable
as $$ select array['inning', 'half', 'balls', 'strikes', 'outs', 'bases', 'home_score', 'away_score',
                   'home_hits', 'away_hits', 'home_errors', 'away_errors', 'line_score', 'state'] $$;

-- Record one play. SECURITY DEFINER because live, status and seq are not
-- writable by anyone directly; the role check below is what lets a play in.
create function public.apply_play(
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
  if jsonb_typeof(p_patch) <> 'object' or jsonb_typeof(p_stats) <> 'array' or jsonb_array_length(p_stats) > 8 then
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
    p_outs, p_bf, p_pitches, p_h, p_r, p_er, p_bb, p_so, p_hbp, p_wp, p_bk)
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
    coalesce(r.p_bk, 0)
  from jsonb_to_recordset(p_stats) as r(side text, bid text,
    b_pa int, b_ab int, b_h int, b_2b int, b_3b int, b_hr int, b_rbi int, b_r int, b_bb int, b_so int, b_kl int,
    b_hbp int, b_sac int, b_sf int, b_roe int, b_fc int, b_sb int, b_cs int,
    p_outs int, p_bf int, p_pitches int, p_h int, p_r int, p_er int, p_bb int, p_so int, p_hbp int, p_wp int, p_bk int);

  return jsonb_build_object('seq', g.seq + 1, 'live', g.live || v_patch, 'status', v_status, 'event', v_event);
end;
$$;

-- Take back the last play: the game as it was before it, and everything it
-- added to anyone's stats.
create function public.undo_play(p_game uuid, p_seq int)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g public.games;
  ev public.game_events;
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
  select * into ev from public.game_events where game_id = p_game order by id desc limit 1;
  if ev.id is null then
    return jsonb_build_object('seq', g.seq, 'live', g.live, 'status', g.status, 'undone', null);
  end if;
  delete from public.game_events where id = ev.id;
  update public.games set live = ev.prev_live, status = ev.prev_status, seq = g.seq + 1 where id = p_game;
  return jsonb_build_object('seq', g.seq + 1, 'live', ev.prev_live, 'status', ev.prev_status, 'undone', ev.type);
end;
$$;

-- --------------------------------------------------------- season stats ----
-- Same columns as before, now with scored games added in. A player's games
-- played is the number of games they came to the plate in (pitching: faced a
-- batter or got an out), counted per game rather than per play.
create or replace view public.season_stats with (security_invoker = true) as
with per_game as (
  select g.team_id, g.season_id, s.player_id, s.game_id,
         sum(s.b_pa) b_pa, sum(s.b_ab) b_ab, sum(s.b_h) b_h, sum(s.b_2b) b_2b, sum(s.b_3b) b_3b, sum(s.b_hr) b_hr,
         sum(s.b_rbi) b_rbi, sum(s.b_r) b_r, sum(s.b_bb) b_bb, sum(s.b_so) b_so, sum(s.b_kl) b_kl, sum(s.b_hbp) b_hbp,
         sum(s.b_sac) b_sac, sum(s.b_sf) b_sf, sum(s.b_roe) b_roe, sum(s.b_fc) b_fc, sum(s.b_sb) b_sb, sum(s.b_cs) b_cs,
         sum(s.p_outs) p_outs, sum(s.p_bf) p_bf, sum(s.p_pitches) p_pitches, sum(s.p_h) p_h, sum(s.p_r) p_r,
         sum(s.p_er) p_er, sum(s.p_bb) p_bb, sum(s.p_so) p_so, sum(s.p_hbp) p_hbp, sum(s.p_wp) p_wp, sum(s.p_bk) p_bk
    from public.game_stats s
    join public.games g on g.id = s.game_id
   where s.side = 'us' and s.player_id is not null and g.counts_for_stats and g.season_id is not null
   group by g.team_id, g.season_id, s.player_id, s.game_id
),
scored as (
  select team_id, season_id, player_id,
         count(*) filter (where b_pa > 0) b_g, sum(b_pa) b_pa, sum(b_ab) b_ab, sum(b_h) b_h, sum(b_2b) b_2b,
         sum(b_3b) b_3b, sum(b_hr) b_hr, sum(b_rbi) b_rbi, sum(b_r) b_r, sum(b_bb) b_bb, sum(b_so) b_so,
         sum(b_kl) b_kl, sum(b_hbp) b_hbp, sum(b_sac) b_sac, sum(b_sf) b_sf, sum(b_roe) b_roe, sum(b_fc) b_fc,
         sum(b_sb) b_sb, sum(b_cs) b_cs,
         count(*) filter (where p_bf > 0 or p_outs > 0) p_g, 0 p_gs, sum(p_outs) p_outs, sum(p_bf) p_bf,
         sum(p_pitches) p_pitches, 0 p_w, 0 p_l, 0 p_sv, sum(p_h) p_h, sum(p_r) p_r, sum(p_er) p_er, sum(p_bb) p_bb,
         sum(p_so) p_so, sum(p_hbp) p_hbp, sum(p_wp) p_wp, sum(p_bk) p_bk,
         null::timestamptz imported_at
    from per_game
   group by team_id, season_id, player_id
),
every_source as (
  select team_id, season_id, player_id,
         b_g, b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_kl, b_hbp, b_sac, b_sf, b_roe, b_fc, b_sb, b_cs,
         p_g, p_gs, p_outs, p_bf, p_pitches, p_w, p_l, p_sv, p_h, p_r, p_er, p_bb, p_so, p_hbp, p_wp, p_bk, imported_at
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
       max(imported_at) imported_at
  from every_source
 group by team_id, season_id, player_id;

-- ------------------------------------------------------------------- RLS ----
alter table public.game_events enable row level security;
alter table public.game_stats enable row level security;

-- The log carries no names (bids at most) but holds whole snapshots: staff only.
create policy game_events_read on public.game_events for select
  using (public.is_team_staff(public.game_team(game_id)));
-- A play's stats name players by id only, like season stats: public.
create policy game_stats_read on public.game_stats for select using (true);

revoke all on public.game_events, public.game_stats from anon, authenticated;
grant select on public.game_events to authenticated;
grant select on public.game_stats to anon, authenticated;

revoke all on function public.live_keys() from public, anon;
grant execute on function public.live_keys() to authenticated;
revoke all on function public.apply_play(uuid, int, text, jsonb, jsonb, jsonb, text) from public, anon;
revoke all on function public.undo_play(uuid, int) from public, anon;
grant execute on function public.apply_play(uuid, int, text, jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function public.undo_play(uuid, int) to authenticated;
