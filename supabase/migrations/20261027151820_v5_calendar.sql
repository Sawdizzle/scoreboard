-- =============================================================================
-- Team calendar: practices and other events beside the games, who is coming,
-- and a feed any calendar app can subscribe to.
-- =============================================================================
--   team_events      practices, meetings, team events. Read by the team's
--                    family (staff and approved guardians); written by its
--                    coaches. Games stay in games.
--   rsvps            one answer per player per game or event: going, maybe or
--                    not. A guardian answers for their own players, staff for
--                    anyone. Family reads them all, for the head count.
--   calendar_tokens  one secret per person per team. /cal/<token>.ics serves
--                    calendar_feed(), so Apple, Google and Outlook calendars
--                    can subscribe without signing in. The feed checks the
--                    person is still on the team every time it is read.
-- =============================================================================

create table public.team_events (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  kind       text not null default 'practice' check (kind in ('practice', 'meeting', 'event')),
  title      text not null check (char_length(title) between 1 and 80),
  starts_at  timestamptz not null,
  ends_at    timestamptz,
  location   text check (location is null or char_length(location) <= 80),
  address    text check (address is null or char_length(address) <= 200),
  notes      text check (notes is null or char_length(notes) <= 1000),
  canceled   boolean not null default false,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_events_ends check (ends_at is null or ends_at >= starts_at)
);
create index team_events_team_idx on public.team_events (team_id, starts_at);

create table public.rsvps (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  game_id    uuid references public.games(id) on delete cascade,
  event_id   uuid references public.team_events(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  status     text not null check (status in ('yes', 'maybe', 'no')),
  note       text check (note is null or char_length(note) <= 140),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint rsvps_one_item check (num_nonnulls(game_id, event_id) = 1)
);
create unique index rsvps_game_player on public.rsvps (game_id, player_id) where game_id is not null;
create unique index rsvps_event_player on public.rsvps (event_id, player_id) where event_id is not null;
create index rsvps_team_idx on public.rsvps (team_id);

create table public.calendar_tokens (
  user_id uuid not null references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  token   uuid not null unique default gen_random_uuid(),
  primary key (user_id, team_id)
);

create function public.team_events_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger team_events_touch before update on public.team_events
  for each row execute function public.team_events_touch();

-- ------------------------------------------------------------------- RPC ----
-- Answer for a player. Staff may answer for anyone; a guardian for their own.
create function public.set_rsvp(p_game uuid, p_event uuid, p_player uuid, p_status text, p_note text default null)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team uuid := coalesce((select team_id from public.games where id = p_game),
                          (select team_id from public.team_events where id = p_event));
begin
  if num_nonnulls(p_game, p_event) <> 1 or v_team is null then
    raise exception 'That game or event is not on the calendar.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.players where id = p_player and team_id = v_team) then
    raise exception 'That player is not on this team.' using errcode = 'P0001';
  end if;
  if not (public.is_team_staff(v_team)
          or (public.is_team_guardian(v_team)
              and exists (select 1 from public.guardian_players where user_id = auth.uid() and player_id = p_player))) then
    raise exception 'You can answer for your own player only.' using errcode = '42501';
  end if;
  if p_status is null then
    delete from public.rsvps where player_id = p_player
       and (game_id = p_game or event_id = p_event);
    return;
  end if;
  if p_game is not null then
    insert into public.rsvps (team_id, game_id, player_id, status, note)
    values (v_team, p_game, p_player, p_status, nullif(trim(p_note), ''))
    on conflict (game_id, player_id) where game_id is not null
    do update set status = excluded.status, note = excluded.note, updated_by = auth.uid(), updated_at = now();
  else
    insert into public.rsvps (team_id, event_id, player_id, status, note)
    values (v_team, p_event, p_player, p_status, nullif(trim(p_note), ''))
    on conflict (event_id, player_id) where event_id is not null
    do update set status = excluded.status, note = excluded.note, updated_by = auth.uid(), updated_at = now();
  end if;
end;
$$;

-- Your subscription link for a team you are on (fans included: they get the
-- games). Made the first time it is asked for; `p_new` replaces it, so an old
-- link that was shared stops working.
create function public.calendar_token(p_team uuid, p_new boolean default false)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_token uuid;
begin
  if not (public.is_team_family(p_team)
          or exists (select 1 from public.team_members where team_id = p_team and user_id = auth.uid() and status = 'active')) then
    raise exception 'Join the team to subscribe to its calendar.' using errcode = '42501';
  end if;
  if p_new then delete from public.calendar_tokens where user_id = auth.uid() and team_id = p_team; end if;
  insert into public.calendar_tokens (user_id, team_id) values (auth.uid(), p_team) on conflict do nothing;
  select token into v_token from public.calendar_tokens where user_id = auth.uid() and team_id = p_team;
  return v_token;
end;
$$;

-- What a subscribed calendar shows, for the holder of the token: the team's
-- games for anyone still on it, and practices, events and addresses for its
-- family. Null for an unknown token or someone who has left.
create function public.calendar_feed(p_token uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_tok public.calendar_tokens;
  v_family boolean;
begin
  select * into v_tok from public.calendar_tokens where token = p_token;
  if v_tok.token is null then return null; end if;
  v_family := exists (select 1 from public.team_staff where team_id = v_tok.team_id and user_id = v_tok.user_id)
           or exists (select 1 from public.teams t join public.org_members m on m.org_id = t.org_id
                       where t.id = v_tok.team_id and m.user_id = v_tok.user_id)
           or exists (select 1 from public.team_members where team_id = v_tok.team_id and user_id = v_tok.user_id
                       and role = 'guardian' and status = 'active');
  if not v_family and not exists (select 1 from public.team_members m join public.teams t on t.id = m.team_id
                                   where m.team_id = v_tok.team_id and m.user_id = v_tok.user_id
                                     and m.status = 'active' and not t.private) then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'team', jsonb_build_object('name', t.name, 'slug', t.slug),
      'games', coalesce((
        select jsonb_agg(jsonb_build_object('id', g.id, 'starts_at', g.starts_at, 'opponent', g.opponent_name,
                 'is_home', g.is_home, 'venue', g.venue, 'address', case when v_family then g.address end,
                 'status', g.status, 'updated_at', g.updated_at) order by g.starts_at)
          from public.games g
         where g.team_id = t.id and g.starts_at is not null and g.starts_at > now() - interval '120 days'), '[]'::jsonb),
      'events', case when v_family then coalesce((
        select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'title', e.title, 'starts_at', e.starts_at,
                 'ends_at', e.ends_at, 'location', e.location, 'address', e.address, 'notes', e.notes,
                 'canceled', e.canceled, 'updated_at', e.updated_at) order by e.starts_at)
          from public.team_events e
         where e.team_id = t.id and e.starts_at > now() - interval '120 days'), '[]'::jsonb) else '[]'::jsonb end)
      from public.teams t where t.id = v_tok.team_id);
end;
$$;

-- ------------------------------------------------------------------- RLS ----
alter table public.team_events     enable row level security;
alter table public.rsvps           enable row level security;
alter table public.calendar_tokens enable row level security;

create policy team_events_read on public.team_events for select to authenticated
  using (public.is_team_family(team_id));
create policy team_events_insert on public.team_events for insert to authenticated
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));
create policy team_events_update on public.team_events for update to authenticated
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']))
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));
create policy team_events_delete on public.team_events for delete to authenticated
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));

create policy rsvps_read on public.rsvps for select to authenticated using (public.is_team_family(team_id));

create policy calendar_tokens_read on public.calendar_tokens for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.team_events, public.rsvps, public.calendar_tokens from anon, authenticated;
grant select, delete on public.team_events to authenticated;
grant insert (team_id, kind, title, starts_at, ends_at, location, address, notes) on public.team_events to authenticated;
grant update (kind, title, starts_at, ends_at, location, address, notes, canceled) on public.team_events to authenticated;
grant select on public.rsvps to authenticated;
grant select on public.calendar_tokens to authenticated;

revoke all on function public.set_rsvp(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.calendar_token(uuid, boolean)         from public, anon;
revoke all on function public.calendar_feed(uuid)                   from public;
revoke all on function public.team_events_touch()                   from public, anon, authenticated;
grant execute on function public.set_rsvp(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.calendar_token(uuid, boolean)         to authenticated;
grant execute on function public.calendar_feed(uuid)                   to anon, authenticated;
