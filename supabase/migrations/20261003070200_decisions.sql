-- =============================================================================
-- Extras 3 — pitching decisions from scored games: W, L, SV and GS.
-- =============================================================================
-- Season stats took wins, losses, saves and starts only from a GameChanger
-- import. Now a game that is marked final works them out from its own plays,
-- for our side, and season_stats adds them in.
--
--   start  the first of our pitchers to throw.
--   win    our pitcher of record when we took the lead for the last time
--          (the one who had last thrown; our starter if nobody had yet).
--   loss   our pitcher on the mound when they took the lead for the last time.
--   save   our last pitcher, when we won and he is not the winner, and he
--          either came in ahead by one to three and got three outs, or got
--          nine outs.
--
-- Youth scorebooks vary; this has no five-inning rule for a starter's win.
-- Reopening a game takes its decisions away until it is final again.
-- =============================================================================

create table public.game_decisions (
  game_id   uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  p_gs int not null default 0 check (p_gs between 0 and 1),
  p_w  int not null default 0 check (p_w  between 0 and 1),
  p_l  int not null default 0 check (p_l  between 0 and 1),
  p_sv int not null default 0 check (p_sv between 0 and 1),
  primary key (game_id, player_id)
);
create index game_decisions_player_idx on public.game_decisions (player_id);
comment on table public.game_decisions is
  'Start, win, loss and save for our pitchers in a final game, worked out from its plays by game_decide().';

create function public.game_decide(p_game uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g public.games;
  ev record;
  p record;
  us int; them int; us_before int; them_before int;
  lead text := null;          -- 'us', 'them' or null for a tie
  now_lead text;
  cur_us text := null; cur_them text := null;   -- who last threw, by side
  first_us text := null;
  w_bid text := null; w_pending boolean := false; l_bid text := null;
  entry_lead int := 0;        -- our lead when our current pitcher came in
  v_outs int;
  ids jsonb := '{}';
begin
  select * into g from public.games where id = p_game;
  delete from public.game_decisions where game_id = p_game;
  if g.id is null or g.status <> 'final' or g.sport <> 'baseball' then
    return;
  end if;

  for ev in
    select e.id, e.prev_live, coalesce(lead(e.prev_live) over (order by e.seq), g.live) as after_live
      from public.game_events e where e.game_id = p_game order by e.seq
  loop
    us_before   := coalesce((ev.prev_live->>(case when g.is_home then 'home_score' else 'away_score' end))::int, 0);
    them_before := coalesce((ev.prev_live->>(case when g.is_home then 'away_score' else 'home_score' end))::int, 0);
    -- Whoever threw in this play is that side's pitcher from here on.
    for p in select s.side, s.bid from public.game_stats s
              where s.event_id = ev.id and (s.p_pitches > 0 or s.p_bf > 0 or s.p_outs > 0) loop
      if p.side = 'us' then
        if first_us is null then first_us := p.bid; end if;
        if cur_us is distinct from p.bid then cur_us := p.bid; entry_lead := us_before - them_before; end if;
      else
        cur_them := p.bid;
      end if;
    end loop;

    us   := coalesce((ev.after_live->>(case when g.is_home then 'home_score' else 'away_score' end))::int, 0);
    them := coalesce((ev.after_live->>(case when g.is_home then 'away_score' else 'home_score' end))::int, 0);
    now_lead := case when us > them then 'us' when them > us then 'them' end;
    if now_lead is distinct from lead then
      -- The lead changed hands, or was lost: earlier decisions no longer stand.
      w_bid := null; w_pending := false; l_bid := null;
      if now_lead = 'us' then
        w_bid := cur_us; w_pending := cur_us is null;
      elsif now_lead = 'them' then
        l_bid := cur_us;
      end if;
      lead := now_lead;
    end if;
  end loop;

  if w_pending then w_bid := first_us; end if;
  if first_us is not null then ids := ids || jsonb_build_object(first_us, jsonb_build_object('p_gs', 1)); end if;
  if lead = 'us' and w_bid is not null then
    ids := jsonb_set(ids, array[w_bid], coalesce(ids->w_bid, '{}') || '{"p_w":1}');
    if cur_us is not null and cur_us <> w_bid then
      select coalesce(sum(s.p_outs), 0) into v_outs from public.game_stats s where s.game_id = p_game and s.side = 'us' and s.bid = cur_us;
      if (entry_lead between 1 and 3 and v_outs >= 3) or v_outs >= 9 then
        ids := jsonb_set(ids, array[cur_us], coalesce(ids->cur_us, '{}') || '{"p_sv":1}');
      end if;
    end if;
  elsif lead = 'them' and l_bid is not null then
    ids := jsonb_set(ids, array[l_bid], coalesce(ids->l_bid, '{}') || '{"p_l":1}');
  end if;

  insert into public.game_decisions (game_id, player_id, p_gs, p_w, p_l, p_sv)
  select p_game, pl.id, coalesce((d.value->>'p_gs')::int, 0), coalesce((d.value->>'p_w')::int, 0),
         coalesce((d.value->>'p_l')::int, 0), coalesce((d.value->>'p_sv')::int, 0)
    from jsonb_each(ids) d
    join public.players pl on pl.team_id = g.team_id and pl.id::text = d.key;
end;
$$;

create function public.games_decide()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform public.game_decide(new.id);
  return new;
end;
$$;
-- Final, reopened, or changed while final (an undo, a correction).
create trigger games_decide after update of status, seq on public.games
  for each row when (new.status = 'final' or old.status = 'final') execute function public.games_decide();

alter table public.game_decisions enable row level security;
create policy game_decisions_read on public.game_decisions for select using (true);
revoke all on public.game_decisions from anon, authenticated;
grant select on public.game_decisions to anon, authenticated;
revoke all on function public.game_decide(uuid) from public, anon, authenticated;
revoke all on function public.games_decide()    from public, anon, authenticated;

-- Season stats: scored games now bring their decisions.
create or replace view public.season_stats with (security_invoker = true) as
with per_game as (
  select g.team_id, g.season_id, s.player_id, s.game_id,
         sum(s.b_pa) b_pa, sum(s.b_ab) b_ab, sum(s.b_h) b_h, sum(s.b_2b) b_2b, sum(s.b_3b) b_3b, sum(s.b_hr) b_hr,
         sum(s.b_rbi) b_rbi, sum(s.b_r) b_r, sum(s.b_bb) b_bb, sum(s.b_so) b_so, sum(s.b_kl) b_kl, sum(s.b_hbp) b_hbp,
         sum(s.b_sac) b_sac, sum(s.b_sf) b_sf, sum(s.b_roe) b_roe, sum(s.b_fc) b_fc, sum(s.b_sb) b_sb, sum(s.b_cs) b_cs,
         sum(s.p_outs) p_outs, sum(s.p_bf) p_bf, sum(s.p_pitches) p_pitches, sum(s.p_h) p_h, sum(s.p_r) p_r,
         sum(s.p_er) p_er, sum(s.p_bb) p_bb, sum(s.p_so) p_so, sum(s.p_hbp) p_hbp, sum(s.p_wp) p_wp, sum(s.p_bk) p_bk,
         coalesce(max(d.p_gs), 0) p_gs, coalesce(max(d.p_w), 0) p_w, coalesce(max(d.p_l), 0) p_l, coalesce(max(d.p_sv), 0) p_sv
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
