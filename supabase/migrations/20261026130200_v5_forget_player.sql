-- =============================================================================
-- Deleting a player forgets their name everywhere it was copied.
-- =============================================================================
-- A lineup copies {bid, num, name} at save time (game_lineups.data, an
-- opponent's saved roster), plays carry text like "At the plate: #12 Alex
-- Raney" (game_events.payload), and a published recap is prose. Deleting the
-- players row left all of those behind. forget_player() scrubs them first:
--   * any object whose bid is the player's id keeps its number, loses its name
--   * the player's name, in every format a screen could have shown it, is
--     replaced by "No. <number>" (or "a player") in the text of lineups,
--     plays, the live state, recaps and saved opponent rosters
-- for every game the team played (as either side) and any other row that
-- names the player by id, then deletes the player.
-- Same seats as deleting a player: an organizer or head coach.
--
-- account_blockers() lists the teams a caller is the only organizer of: an
-- account can be deleted (by the server, lib/supabase/admin.ts) once that
-- list is empty, so no team is left with nobody to run it.
-- =============================================================================

-- Blank the name of every object in j whose bid is p_bid, at any depth.
create function private.forget_bid(j jsonb, p_bid text)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(j) = 'object' then
    select coalesce(jsonb_object_agg(k, private.forget_bid(v, p_bid)), '{}'::jsonb) into j from jsonb_each(j) as e(k, v);
    if j->>'bid' = p_bid and j ? 'name' then
      j := j || jsonb_build_object('name', '');
    end if;
    return j;
  elsif jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(private.forget_bid(v, p_bid) order by o)
                       from jsonb_array_elements(j) with ordinality as e(v, o)), '[]'::jsonb);
  end if;
  return j;
end;
$$;

-- Replace each of p_names (whole words only, longest first) in j's text.
create function private.forget_names(j jsonb, p_names text[], p_stand_in text)
returns jsonb
language plpgsql immutable
set search_path = public, pg_temp
as $$
declare
  s text := j::text;
  n text;
begin
  if j is null then
    return null;
  end if;
  foreach n in array p_names loop
    s := regexp_replace(s,
           '(?<![[:alnum:]])' || regexp_replace(n, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '(?![[:alnum:]])',
           p_stand_in, 'g');
  end loop;
  return s::jsonb;
end;
$$;

create function public.forget_player(p_player uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  p public.players;
  v_bid text := p_player::text;
  v_names text[];
  v_in text;
begin
  select * into p from public.players where id = p_player;
  if p.id is null then
    return;
  end if;
  if not public.has_team_role(p.team_id, array['organizer', 'head_coach']) then
    raise exception 'Only an organizer or head coach can delete a player.' using errcode = '42501';
  end if;

  select coalesce(array_agg(n order by char_length(n) desc), '{}') into v_names
    from (select distinct n from unnest(array[
            public.format_name(p.first_name, p.last_name, 'full'),
            public.format_name(p.first_name, p.last_name, 'initial_last'),
            public.format_name(p.first_name, p.last_name, 'first_initial'),
            nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')]) n
           where char_length(n) >= 2) x;
  v_in := case when coalesce(p.number, '') <> '' then 'No. ' || p.number else 'a player' end;

  update public.game_lineups l
     set data = private.forget_names(private.forget_bid(l.data, v_bid), v_names, v_in)
    from public.games g
   where g.id = l.game_id and (g.team_id = p.team_id or g.opponent_team_id = p.team_id or l.data::text like '%' || v_bid || '%');

  update public.game_events e
     set payload = private.forget_names(private.forget_bid(e.payload, v_bid), v_names, v_in)
    from public.games g
   where g.id = e.game_id and (g.team_id = p.team_id or g.opponent_team_id = p.team_id or e.payload::text like '%' || v_bid || '%');

  update public.games g
     set live = private.forget_names(private.forget_bid(g.live, v_bid), v_names, v_in)
   where g.team_id = p.team_id or g.opponent_team_id = p.team_id;

  update public.game_recaps r
     set content = private.forget_names(private.forget_bid(r.content, v_bid), v_names, v_in),
         facts = private.forget_names(private.forget_bid(r.facts, v_bid), v_names, v_in)
    from public.games g
   where g.id = r.game_id and (g.team_id = p.team_id or g.opponent_team_id = p.team_id or r.facts::text like '%' || v_bid || '%');

  -- A saved opponent roster on any team that typed this player in by id.
  update public.opponents o
     set roster = private.forget_names(private.forget_bid(o.roster, v_bid), v_names, v_in)
   where o.roster::text like '%' || v_bid || '%';

  delete from public.players where id = p_player;
end;
$$;

create function public.account_blockers()
returns table (slug text, name text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select t.slug, t.name
    from public.team_staff s join public.teams t on t.id = s.team_id
   where s.user_id = auth.uid() and s.role = 'organizer'
     and not exists (select 1 from public.team_staff o
                      where o.team_id = s.team_id and o.role = 'organizer' and o.user_id <> s.user_id)
   order by t.name;
$$;

revoke all on function private.forget_bid(jsonb, text) from public, anon, authenticated;
revoke all on function private.forget_names(jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.forget_player(uuid) from public, anon;
revoke all on function public.account_blockers() from public, anon;
grant execute on function public.forget_player(uuid) to authenticated;
grant execute on function public.account_blockers() to authenticated;
