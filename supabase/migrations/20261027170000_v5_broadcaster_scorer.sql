-- =============================================================================
-- Broadcaster and scorer: two volunteer jobs, each with only what it needs.
-- =============================================================================
-- The 'media' seat is the Broadcaster (the app's label; the value stays, so
-- no seat moves). It runs the stream: the overlay link, the looks, scenes and
-- cards, the sponsor and the channel bug.
--
-- The Scorer scores: lineups and the batting order, the game's start time,
-- and every play. Not the stream, not the team's games list.
--
--   channels          the stream's settings, and the On Air calls made
--                     through set_broadcast and send_cmd (both run as the
--                     caller): coaches and broadcasters. A scorer's pad no
--                     longer drives the stream; the overlay follows the score
--                     on its own.
--   set_sponsor,      team admin, head coach and broadcaster.
--   set_stream_bug,
--   reset_stream_link
--   games             a new game, or one deleted: coaches only (deleting stays
--                     with team admin and head coach). A scorer may change
--                     the start time, swap home and away, run the game clock,
--                     and link the opponent a lineup names; nothing else.
--   opponents         a scorer saves an opponent's lineup, so still adds and
--                     updates them, but no longer deletes one.
--   seats             five coaching seats (team admin, head coach, coach).
--                     Scorers and broadcasters are volunteers, counted apart,
--                     twenty at most.
-- =============================================================================

-- ------------------------------------------------------------------ stream ----
alter policy channels_update on public.channels
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'media']))
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'media']));

create or replace function public.set_sponsor(p_team uuid, p_name text, p_line text, p_logo text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_team_role(p_team, array['organizer', 'head_coach', 'media']) then
    raise exception 'Only a team admin, head coach or broadcaster can set the sponsor.' using errcode = '42501';
  end if;
  update public.channels
     set sponsor_name = nullif(trim(p_name), ''), sponsor_line = nullif(trim(p_line), ''), sponsor_logo = nullif(trim(p_logo), ''),
         card = case when nullif(trim(p_name), '') is null and card = 'sponsor' then null else card end
   where team_id = p_team;
end;
$$;

create or replace function public.reset_stream_link(p_team uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_token uuid;
begin
  if not public.has_team_role(p_team, array['organizer', 'head_coach', 'media']) then
    raise exception 'Only a team admin, head coach or broadcaster can change the stream link.' using errcode = '42501';
  end if;
  update public.channels set token = gen_random_uuid() where team_id = p_team returning token into v_token;
  return v_token;
end;
$$;

create or replace function public.set_stream_bug(p_team uuid, p_text text, p_url text)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_team_role(p_team, array['organizer', 'head_coach', 'media']) then
    raise exception 'Only a team admin, head coach or broadcaster can set the channel bug.' using errcode = '42501';
  end if;
  update public.channels
     set bug_text = nullif(trim(p_text), ''), bug_url = nullif(trim(p_url), ''),
         card = case when nullif(trim(p_url), '') is null and card = 'qr' then null else card end
   where team_id = p_team;
end;
$$;

-- ------------------------------------------------------------------- games ----
alter policy games_insert on public.games
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));

-- What a scorer (with no coaching seat) may change on a game. The pad's own
-- writes (live, status, seq) come through apply_play and are not looked at.
create function public.games_scorer_columns()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- A cascade (another team deleted, its season gone) is the database's own
  -- doing, not the scorer's: it arrives a trigger deep.
  if auth.uid() is null or pg_trigger_depth() > 1
     or public.has_team_role(old.team_id, array['organizer', 'head_coach', 'coach']) then
    return new;
  end if;
  if (new.season_id, new.counts_for_stats, new.opponent_team_id, new.opponent_name, new.opponent_abbr,
      new.opponent_color, new.venue, new.address, new.tournament_url, new.settings, new.venue_geo)
     is distinct from
     (old.season_id, old.counts_for_stats, old.opponent_team_id, old.opponent_name, old.opponent_abbr,
      old.opponent_color, old.venue, old.address, old.tournament_url, old.settings, old.venue_geo)
     or (old.opponent_id is not null and new.opponent_id is distinct from old.opponent_id) then
    raise exception 'A scorer can change the start time and score the game. Ask a coach for the rest.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger games_scorer_columns before update on public.games
  for each row execute function public.games_scorer_columns();
revoke all on function public.games_scorer_columns() from public, anon, authenticated;

alter policy opponents_delete on public.opponents
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));

-- ------------------------------------------------------------------- seats ----
create function public.is_volunteer_role(p_role text)
returns boolean
language sql immutable
set search_path = public, pg_temp
as $$ select p_role in ('scorer', 'media') $$;

create or replace function public.team_staff_seat_limit()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_vol boolean := public.is_volunteer_role(new.role);
begin
  if tg_op = 'UPDATE' and v_vol = public.is_volunteer_role(old.role) then
    return new;
  end if;
  perform 1 from public.teams where id = new.team_id for update;
  if (select count(*) from public.team_staff
       where team_id = new.team_id and public.is_volunteer_role(role) = v_vol) >= (case when v_vol then 20 else 5 end) then
    raise exception '%', (case when v_vol then 'This team already has twenty scorers and broadcasters.'
                               else 'This team already has five staff.' end) using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.staff_invites_seat_limit()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_vol boolean := public.is_volunteer_role(new.role);
begin
  perform 1 from public.teams where id = new.team_id for update;
  if (select count(*) from public.team_staff where team_id = new.team_id and public.is_volunteer_role(role) = v_vol)
     + (select count(*) from public.staff_invites
         where team_id = new.team_id and public.is_volunteer_role(role) = v_vol and used_at is null and expires_at > now())
     >= (case when v_vol then 20 else 5 end) then
    raise exception '%', (case when v_vol then 'All twenty volunteer seats are filled or have a link out.'
                               else 'All five seats are filled or have a link out.' end) using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.invite_preview(p_token uuid)
returns table (team_name text, display_name text, team_color text, team_color2 text, logo_url text,
               age_group text, role text, state text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select t.name, t.display_name, t.color, t.color2, t.logo_url, t.age_group, i.role,
         case
           when i.used_at is not null then 'used'
           when i.expires_at <= now() then 'expired'
           when (select count(*) from public.team_staff s
                  where s.team_id = i.team_id and public.is_volunteer_role(s.role) = public.is_volunteer_role(i.role))
                >= case when public.is_volunteer_role(i.role) then 20 else 5 end then 'full'
           else 'open'
         end
    from public.staff_invites i
    join public.teams t on t.id = i.team_id
   where i.token = p_token;
$$;

revoke all on function public.is_volunteer_role(text) from public, anon;
grant execute on function public.is_volunteer_role(text) to authenticated;
