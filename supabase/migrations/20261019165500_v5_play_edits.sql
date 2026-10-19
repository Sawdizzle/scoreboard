-- =============================================================================
-- Fixing a credit on an earlier play, the way GameChanger's Plays tab does.
-- =============================================================================
-- Two kinds of fix. Neither moves the game itself: the score, the outs and
-- the bases stay as they are, and an outcome that was wrong is still Undo's
-- to fix.
--
--   edit_play_credit    the wrong kid was credited: the batter, a runner or
--                       the pitcher. Every stat row that play gave him moves
--                       to the right one. A kid who already has a part in
--                       that play cannot take another's.
--   edit_play_fielding  the fielders were wrong: a new code ("5-3" for
--                       "6-3") and the putouts, assists, errors and the
--                       catcher's pickoff it gives, which the pad works out
--                       from the code (lib/scoring fieldingCredit). The
--                       play-by-play shows the new code.
--
-- For the staff who score (organizer, head coach, coach, scorer), in a live
-- game or a final one. Season stats follow at once: they are sums of these
-- rows. The game's seq does not move, so a phone scoring the game is not
-- stopped by a fix made on another.
-- =============================================================================

create function public.edit_play_credit(p_game uuid, p_event bigint, p_side text, p_from text, p_to text)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g public.games;
  v_pid uuid;
  v_n int;
begin
  select * into g from public.games where id = p_game;
  if g.id is null then
    raise exception 'That game does not exist.' using errcode = 'P0001';
  end if;
  if not public.has_team_role(g.team_id, array['organizer', 'head_coach', 'coach', 'scorer']) then
    raise exception 'Your seat cannot edit this game.' using errcode = '42501';
  end if;
  if p_side is null or p_side not in ('us', 'them') or coalesce(p_from, '') = '' or coalesce(p_to, '') = ''
     or p_from = p_to or p_to !~ '^[A-Za-z0-9_-]{1,64}$' then
    raise exception 'That edit could not be read.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.game_events where id = p_event and game_id = p_game) then
    raise exception 'That play is not in this game any more.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.game_stats where event_id = p_event and side = p_side and bid = p_to) then
    raise exception 'That player already has a part in this play.' using errcode = 'P0001';
  end if;
  -- Our side's bids are player ids: keep one only if it is this team's player.
  if p_side = 'us' then
    select id into v_pid from public.players where team_id = g.team_id and id::text = p_to;
  end if;
  update public.game_stats set bid = p_to, player_id = v_pid
   where event_id = p_event and side = p_side and bid = p_from;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nobody by that name has a part in this play.' using errcode = 'P0001';
  end if;
  return v_n;
end;
$$;

-- p_rows: [{ bid, f_po, f_a, f_e, c_pik }] for the side in the field.
create function public.edit_play_fielding(p_game uuid, p_event bigint, p_side text, p_code text, p_rows jsonb)
returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  g public.games;
  r record;
  v_row bigint;
  v_n int := 0;
begin
  select * into g from public.games where id = p_game;
  if g.id is null then
    raise exception 'That game does not exist.' using errcode = 'P0001';
  end if;
  if not public.has_team_role(g.team_id, array['organizer', 'head_coach', 'coach', 'scorer']) then
    raise exception 'Your seat cannot edit this game.' using errcode = '42501';
  end if;
  if p_side is null or p_side not in ('us', 'them') or p_code is null or char_length(p_code) > 24
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 8 then
    raise exception 'That edit could not be read.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.game_events where id = p_event and game_id = p_game and payload ? 'play') then
    raise exception 'That play has no fielders to fix.' using errcode = 'P0001';
  end if;

  update public.game_stats set f_po = 0, f_a = 0, f_e = 0, c_pik = 0
   where event_id = p_event and side = p_side;
  for r in select * from jsonb_to_recordset(p_rows) as x(bid text, f_po int, f_a int, f_e int, c_pik int) loop
    if r.bid is null or r.bid !~ '^[A-Za-z0-9_-]{1,64}$' then
      raise exception 'That edit could not be read.' using errcode = 'P0001';
    end if;
    select id into v_row from public.game_stats where event_id = p_event and side = p_side and bid = r.bid order by id limit 1;
    if v_row is not null then
      update public.game_stats set f_po = coalesce(r.f_po, 0), f_a = coalesce(r.f_a, 0), f_e = coalesce(r.f_e, 0), c_pik = coalesce(r.c_pik, 0)
       where id = v_row;
    else
      insert into public.game_stats (event_id, game_id, side, bid, player_id, f_po, f_a, f_e, c_pik)
      values (p_event, p_game, p_side, r.bid,
              case when p_side = 'us' then (select id from public.players where team_id = g.team_id and id::text = r.bid) end,
              coalesce(r.f_po, 0), coalesce(r.f_a, 0), coalesce(r.f_e, 0), coalesce(r.c_pik, 0));
    end if;
    v_n := v_n + 1;
  end loop;
  update public.game_events set payload = jsonb_set(payload, '{play,code}', to_jsonb(p_code)) where id = p_event;
  return v_n;
end;
$$;

revoke all on function public.edit_play_credit(uuid, bigint, text, text, text) from public, anon;
grant execute on function public.edit_play_credit(uuid, bigint, text, text, text) to authenticated;
revoke all on function public.edit_play_fielding(uuid, bigint, text, text, jsonb) from public, anon;
grant execute on function public.edit_play_fielding(uuid, bigint, text, text, jsonb) to authenticated;
