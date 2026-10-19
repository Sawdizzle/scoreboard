-- =============================================================================
-- Pitching decisions at Game over, as GameChanger asks for them.
-- =============================================================================
-- game_decide() works out our start, win, loss and save from the plays when a
-- game goes final, and again on every change while it is final. Youth
-- scorebooks vary (a five-inning rule for a starter's win, a league's own
-- save rule), so the scorer can now say who got them: the pad asks at Game
-- over, filled in with what game_decide picked, and "Keep these" (GameChanger's
-- Skip & finalize) leaves them worked out.
--
--   games.decisions   null: worked out. Otherwise { w, l, sv }: our players'
--                     ids, each or null. The start is always worked out.
--
-- set_game_decisions() saves the picks for a final game, for the staff who
-- score, and only for our own pitchers who pitched in it: a win and a save in
-- a game we won (the save to someone other than the winner), a loss in one we
-- lost. clear_game_decisions() goes back to worked out. Either runs
-- game_decide() at once; the games_decide trigger (on status and seq) keeps
-- them after that, an undo or a reopen included. A pick stands only for the
-- result it was made for: reopened and ended the other way, the game's
-- decisions are worked out again until the scorer picks anew.
-- =============================================================================

alter table public.games add column decisions jsonb
  check (decisions is null or jsonb_typeof(decisions) = 'object');
comment on column public.games.decisions is
  'The scorer''s own pitching decisions for our side ({ w, l, sv } player ids), or null when game_decide() works them out.';

create or replace function public.game_decide(p_game uuid)
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
  k text;
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

  -- The scorer's own picks, made at Game over, stand in for the win, the loss
  -- and the save worked out above, while the result is the one they were made
  -- for. The start stays worked out.
  if g.decisions is not null
     and ((lead = 'us' and g.decisions->>'l' is null)
       or (lead = 'them' and g.decisions->>'w' is null and g.decisions->>'sv' is null)) then
    for k in select jsonb_object_keys(ids) loop
      ids := jsonb_set(ids, array[k], (ids->k) - 'p_w' - 'p_l' - 'p_sv');
    end loop;
    if g.decisions->>'w' is not null then
      ids := jsonb_set(ids, array[g.decisions->>'w'], coalesce(ids->(g.decisions->>'w'), '{}') || '{"p_w":1}');
    end if;
    if g.decisions->>'l' is not null then
      ids := jsonb_set(ids, array[g.decisions->>'l'], coalesce(ids->(g.decisions->>'l'), '{}') || '{"p_l":1}');
    end if;
    if g.decisions->>'sv' is not null then
      ids := jsonb_set(ids, array[g.decisions->>'sv'], coalesce(ids->(g.decisions->>'sv'), '{}') || '{"p_sv":1}');
    end if;
  end if;

  insert into public.game_decisions (game_id, player_id, p_gs, p_w, p_l, p_sv)
  select p_game, pl.id, coalesce((d.value->>'p_gs')::int, 0), coalesce((d.value->>'p_w')::int, 0),
         coalesce((d.value->>'p_l')::int, 0), coalesce((d.value->>'p_sv')::int, 0)
    from jsonb_each(ids) d
    join public.players pl on pl.team_id = g.team_id and pl.id::text = d.key;
end;
$$;

create function public.set_game_decisions(p_game uuid, p_w uuid, p_l uuid, p_sv uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g public.games;
  v uuid;
  us int; them int;
begin
  select * into g from public.games where id = p_game;
  if g.id is null then
    raise exception 'That game does not exist.' using errcode = 'P0001';
  end if;
  if not public.has_team_role(g.team_id, array['organizer', 'head_coach', 'coach', 'scorer']) then
    raise exception 'Your seat cannot edit this game.' using errcode = '42501';
  end if;
  if g.status <> 'final' then
    raise exception 'Pitching decisions are for a final game.' using errcode = 'P0001';
  end if;
  if p_w is not null and p_l is not null then
    raise exception 'We cannot both win and lose: pick a winning or a losing pitcher.' using errcode = 'P0001';
  end if;
  us   := coalesce((g.live->>(case when g.is_home then 'home_score' else 'away_score' end))::int, 0);
  them := coalesce((g.live->>(case when g.is_home then 'away_score' else 'home_score' end))::int, 0);
  if (p_w is not null or p_sv is not null) and us <= them then
    raise exception 'A win and a save are ours to give only in a game we won.' using errcode = 'P0001';
  end if;
  if p_l is not null and us >= them then
    raise exception 'A loss is ours to give only in a game we lost.' using errcode = 'P0001';
  end if;
  if p_sv is not null and (p_w is null or p_sv = p_w) then
    raise exception 'A save goes with a win, to someone other than the winner.' using errcode = 'P0001';
  end if;
  foreach v in array array_remove(array[p_w, p_l, p_sv], null) loop
    if not exists (select 1 from public.game_stats s
                    where s.game_id = p_game and s.side = 'us' and s.player_id = v
                      and (s.p_pitches > 0 or s.p_bf > 0 or s.p_outs > 0)) then
      raise exception 'Pick one of our pitchers who pitched in this game.' using errcode = 'P0001';
    end if;
  end loop;
  update public.games set decisions = jsonb_build_object('w', p_w, 'l', p_l, 'sv', p_sv) where id = p_game;
  perform public.game_decide(p_game);
end;
$$;

create function public.clear_game_decisions(p_game uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g public.games;
begin
  select * into g from public.games where id = p_game;
  if g.id is null then
    raise exception 'That game does not exist.' using errcode = 'P0001';
  end if;
  if not public.has_team_role(g.team_id, array['organizer', 'head_coach', 'coach', 'scorer']) then
    raise exception 'Your seat cannot edit this game.' using errcode = '42501';
  end if;
  update public.games set decisions = null where id = p_game;
  perform public.game_decide(p_game);
end;
$$;

revoke all on function public.game_decide(uuid) from public, anon, authenticated;
revoke all on function public.set_game_decisions(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.set_game_decisions(uuid, uuid, uuid, uuid) to authenticated;
revoke all on function public.clear_game_decisions(uuid) from public, anon;
grant execute on function public.clear_game_decisions(uuid) to authenticated;
