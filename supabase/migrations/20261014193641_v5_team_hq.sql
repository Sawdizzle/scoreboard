-- =============================================================================
-- Stage 1 — Team HQ: accounts, teams, five staff seats, roster, seasons.
-- =============================================================================
-- Who may read what:
--
--   teams, team_staff, seasons, profiles   public. A team page is readable
--                                          without an account, and it lists the
--                                          staff by display name.
--   players                                staff only. The public reads a roster
--                                          through public_roster(), which applies
--                                          each player's "shown publicly as"
--                                          setting. The table itself has no
--                                          public policy, so a full name that is
--                                          set to show as initials cannot be
--                                          read around the function.
--   staff_invites                          the team's organizers only. Anyone
--                                          holding a link sees the team name and
--                                          role through invite_preview().
--
-- Who may write what:
--
--   organizer             everything, including seats and deleting the team
--   organizer, head_coach team identity, roster, seasons
--   coach, scorer, media  nothing in this stage (lineups, scoring and the
--                         overlay arrive with the stages that add them)
--
-- A team is created, and a seat is filled, only through the functions below.
-- Neither table has an insert policy.
-- =============================================================================

-- ------------------------------------------------------------------ tables ----
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  created_at   timestamptz not null default now()
);
comment on table public.profiles is
  'One row per account: the name shown on staff lists. Created by a trigger on auth.users.';

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,70}$'),
  name       text not null check (char_length(name) between 1 and 60),
  abbr       text not null check (char_length(abbr) between 1 and 6),
  color      text not null default '#2f63cc' check (color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url   text check (logo_url is null or char_length(logo_url) <= 500),
  age_group  text check (age_group is null or char_length(age_group) <= 12),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.team_staff (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('organizer', 'head_coach', 'coach', 'scorer', 'media')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_staff_user_idx on public.team_staff (user_id);
comment on table public.team_staff is
  'A seat on a team. Five per team at most (team_staff_seat_limit), and never zero organizers (team_staff_keep_organizer).';

create table public.staff_invites (
  token      uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  role       text not null check (role in ('organizer', 'head_coach', 'coach', 'scorer', 'media')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by    uuid references auth.users(id) on delete set null,
  used_at    timestamptz
);
create index staff_invites_team_idx on public.staff_invites (team_id);
comment on table public.staff_invites is
  'A one-use link to a seat. The token is the secret; an open link holds its seat until it is used, revoked or expires.';

create table public.players (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  first_name  text not null default '' check (char_length(first_name) <= 40),
  last_name   text not null default '' check (char_length(last_name) <= 40),
  number      text not null default '' check (number ~ '^[0-9]{0,3}$'),
  bats        text check (bats in ('R', 'L', 'S')),
  throws      text check (throws in ('R', 'L')),
  positions   text[] not null default '{}'
              check (positions <@ array['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'UT']),
  public_name text not null default 'full' check (public_name in ('full', 'first_initial', 'number')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint players_somebody check (first_name <> '' or last_name <> '' or number <> '')
);
create index players_team_idx on public.players (team_id);
comment on column public.players.public_name is
  'How this player appears on public pages and the stream: full name, first name and last initial, or jersey number only.';

create table public.seasons (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  starts_on  date,
  ends_on    date,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  constraint seasons_dates check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
create unique index seasons_one_current on public.seasons (team_id) where is_current;
create unique index seasons_team_name on public.seasons (team_id, lower(name));

-- --------------------------------------------------------------- helpers ----
-- SECURITY DEFINER so a policy on team_staff can ask "is the caller on this
-- team" without that question running into team_staff's own policies.
create function public.has_team_role(p_team uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_staff s
     where s.team_id = p_team and s.user_id = (select auth.uid()) and s.role = any (p_roles)
  );
$$;

create function public.is_team_staff(p_team uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_staff s
     where s.team_id = p_team and s.user_id = (select auth.uid())
  );
$$;

-- -------------------------------------------------------------- triggers ----
-- Every account gets a profile. The name comes from the sign-up form, and
-- falls back to the part of the email before the @.
create function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                  nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                  'Staff'), 60)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Five seats. The team row is locked first, so two people accepting the last
-- seat at the same moment are counted one after the other.
create function public.team_staff_seat_limit()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.teams where id = new.team_id for update;
  if (select count(*) from public.team_staff where team_id = new.team_id) >= 5 then
    raise exception 'This team already has five staff.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger team_staff_seat_limit before insert on public.team_staff
  for each row execute function public.team_staff_seat_limit();

-- A team always has an organizer: the last one can neither leave nor be given
-- another role. Deleting the whole team, or the account, is not blocked.
create function public.team_staff_keep_organizer()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if old.role <> 'organizer' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.role = 'organizer' then return new; end if;
  if not exists (select 1 from public.teams where id = old.team_id) then return old; end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.profiles where id = old.user_id) then return old; end if;
  perform 1 from public.teams where id = old.team_id for update;
  if not exists (
    select 1 from public.team_staff
     where team_id = old.team_id and role = 'organizer' and user_id <> old.user_id
  ) then
    raise exception 'A team needs an organizer. Make someone else an organizer first.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger team_staff_keep_organizer before update or delete on public.team_staff
  for each row execute function public.team_staff_keep_organizer();

-- An open link holds a seat, so the Staff screen never offers a sixth.
create function public.staff_invites_seat_limit()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform 1 from public.teams where id = new.team_id for update;
  if (select count(*) from public.team_staff where team_id = new.team_id)
     + (select count(*) from public.staff_invites
         where team_id = new.team_id and used_at is null and expires_at > now()) >= 5 then
    raise exception 'All five seats are filled or have a link out.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger staff_invites_seat_limit before insert on public.staff_invites
  for each row execute function public.staff_invites_seat_limit();

-- One current season per team: marking one current unmarks the others.
create function public.seasons_single_current()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_current then
    update public.seasons set is_current = false
     where team_id = new.team_id and id <> new.id and is_current;
  end if;
  return new;
end;
$$;
create trigger seasons_single_current before insert or update of is_current on public.seasons
  for each row execute function public.seasons_single_current();

-- ------------------------------------------------------------------- RPC ----
-- A team, its first organizer and its first season, in one transaction.
create function public.create_team(
  p_name text, p_abbr text, p_color text default '#2f63cc',
  p_age_group text default null, p_season text default null)
returns public.teams
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_base text;
  v_slug text;
  v_team public.teams;
begin
  if v_uid is null then
    raise exception 'Sign in to create a team.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'This account has no profile yet.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.teams where created_by = v_uid) >= 20 then
    raise exception 'This account has created 20 teams, which is the limit.' using errcode = 'P0001';
  end if;

  v_base := trim(both '-' from regexp_replace(
              lower(trim(p_name) || coalesce('-' || nullif(trim(p_age_group), ''), '')),
              '[^a-z0-9]+', '-', 'g'));
  if char_length(v_base) < 2 then v_base := 'team'; end if;
  v_base := left(v_base, 60);
  v_slug := v_base;
  while exists (select 1 from public.teams where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 4);
  end loop;

  insert into public.teams (slug, name, abbr, color, age_group, created_by)
  values (v_slug, trim(p_name), upper(trim(p_abbr)), coalesce(p_color, '#2f63cc'),
          nullif(trim(p_age_group), ''), v_uid)
  returning * into v_team;

  insert into public.team_staff (team_id, user_id, role) values (v_team.id, v_uid, 'organizer');

  if nullif(trim(p_season), '') is not null then
    insert into public.seasons (team_id, name, is_current) values (v_team.id, trim(p_season), true);
  end if;

  return v_team;
end;
$$;

-- What a link is for, shown before sign-in. Returns nothing for an unknown
-- token, so it cannot be used to list teams.
create function public.invite_preview(p_token uuid)
returns table (team_name text, team_abbr text, team_color text, age_group text, role text, state text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select t.name, t.abbr, t.color, t.age_group, i.role,
         case
           when i.used_at is not null then 'used'
           when i.expires_at <= now() then 'expired'
           when (select count(*) from public.team_staff s where s.team_id = i.team_id) >= 5 then 'full'
           else 'open'
         end
    from public.staff_invites i
    join public.teams t on t.id = i.team_id
   where i.token = p_token;
$$;

-- Take the seat. Returns the team's slug so the app can go straight there.
create function public.accept_invite(p_token uuid)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.staff_invites;
  v_slug text;
begin
  if v_uid is null then
    raise exception 'Sign in to accept this invite.' using errcode = '42501';
  end if;
  select * into v_inv from public.staff_invites where token = p_token for update;
  if v_inv.token is null then
    raise exception 'This invite link is not valid.' using errcode = 'P0001';
  end if;
  if v_inv.used_at is not null then
    raise exception 'This invite link was already used.' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invite link has expired. Ask for a new one.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.team_staff where team_id = v_inv.team_id and user_id = v_uid) then
    raise exception 'You are already on this team.' using errcode = 'P0001';
  end if;

  insert into public.team_staff (team_id, user_id, role) values (v_inv.team_id, v_uid, v_inv.role);
  update public.staff_invites set used_by = v_uid, used_at = now() where token = p_token;

  select slug into v_slug from public.teams where id = v_inv.team_id;
  return v_slug;
end;
$$;

-- The roster as the public sees it. Active players only, each under the name
-- its staff chose to show.
create function public.public_roster(p_team uuid)
returns table (id uuid, number text, display_name text, positions text[], bats text, throws text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.number,
         case p.public_name
           when 'full' then nullif(trim(p.first_name || ' ' || p.last_name), '')
           when 'first_initial' then nullif(trim(p.first_name || ' ' ||
                  case when p.last_name <> '' then left(p.last_name, 1) || '.' else '' end), '')
           else null
         end,
         p.positions, p.bats, p.throws
    from public.players p
   where p.team_id = p_team and p.active
   order by nullif(p.number, '')::int nulls last, p.last_name, p.first_name;
$$;

-- ------------------------------------------------------------------- RLS ----
alter table public.profiles      enable row level security;
alter table public.teams         enable row level security;
alter table public.team_staff    enable row level security;
alter table public.staff_invites enable row level security;
alter table public.players       enable row level security;
alter table public.seasons       enable row level security;

create policy profiles_read   on public.profiles for select using (true);
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy teams_read   on public.teams for select using (true);
create policy teams_update on public.teams for update
  using (public.has_team_role(id, array['organizer', 'head_coach']))
  with check (public.has_team_role(id, array['organizer', 'head_coach']));
create policy teams_delete on public.teams for delete
  using (public.has_team_role(id, array['organizer']));

create policy team_staff_read   on public.team_staff for select using (true);
create policy team_staff_update on public.team_staff for update
  using (public.has_team_role(team_id, array['organizer']))
  with check (public.has_team_role(team_id, array['organizer']));
-- An organizer removes anyone; anyone may leave.
create policy team_staff_delete on public.team_staff for delete
  using (public.has_team_role(team_id, array['organizer']) or user_id = (select auth.uid()));

create policy staff_invites_read   on public.staff_invites for select
  using (public.has_team_role(team_id, array['organizer']));
create policy staff_invites_insert on public.staff_invites for insert
  with check (public.has_team_role(team_id, array['organizer']) and created_by = (select auth.uid()));
create policy staff_invites_delete on public.staff_invites for delete
  using (public.has_team_role(team_id, array['organizer']));

create policy players_read   on public.players for select using (public.is_team_staff(team_id));
create policy players_insert on public.players for insert
  with check (public.has_team_role(team_id, array['organizer', 'head_coach']));
create policy players_update on public.players for update
  using (public.has_team_role(team_id, array['organizer', 'head_coach']))
  with check (public.has_team_role(team_id, array['organizer', 'head_coach']));
create policy players_delete on public.players for delete
  using (public.has_team_role(team_id, array['organizer', 'head_coach']));

create policy seasons_read   on public.seasons for select using (true);
create policy seasons_insert on public.seasons for insert
  with check (public.has_team_role(team_id, array['organizer', 'head_coach']));
create policy seasons_update on public.seasons for update
  using (public.has_team_role(team_id, array['organizer', 'head_coach']))
  with check (public.has_team_role(team_id, array['organizer', 'head_coach']));
create policy seasons_delete on public.seasons for delete
  using (public.has_team_role(team_id, array['organizer', 'head_coach']));

-- ---------------------------------------------------------------- grants ----
-- Stated in full rather than left to the project's default privileges, so the
-- file means the same thing on any project it is applied to. Column lists on
-- update keep ids, slugs and team ownership out of reach of a row policy.
revoke all on public.profiles, public.teams, public.team_staff, public.staff_invites,
              public.players, public.seasons from anon, authenticated;

grant select on public.profiles, public.teams, public.team_staff, public.seasons to anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
grant update (name, abbr, color, logo_url, age_group) on public.teams to authenticated;
grant delete on public.teams to authenticated;
grant update (role) on public.team_staff to authenticated;
grant delete on public.team_staff to authenticated;
grant select, delete on public.staff_invites to authenticated;
grant insert (team_id, role) on public.staff_invites to authenticated;
grant select, delete on public.players to authenticated;
grant insert (team_id, first_name, last_name, number, bats, throws, positions, public_name, active)
  on public.players to authenticated;
grant update (first_name, last_name, number, bats, throws, positions, public_name, active)
  on public.players to authenticated;
grant select, delete on public.seasons to authenticated;
grant insert (team_id, name, starts_on, ends_on, is_current) on public.seasons to authenticated;
grant update (name, starts_on, ends_on, is_current) on public.seasons to authenticated;

revoke all on function public.has_team_role(uuid, text[])  from public, anon;
revoke all on function public.is_team_staff(uuid)          from public, anon;
revoke all on function public.create_team(text, text, text, text, text) from public, anon;
revoke all on function public.accept_invite(uuid)          from public, anon;
revoke all on function public.invite_preview(uuid)         from public;
revoke all on function public.public_roster(uuid)          from public;
revoke all on function public.handle_new_user()            from public, anon, authenticated;
revoke all on function public.team_staff_seat_limit()      from public, anon, authenticated;
revoke all on function public.team_staff_keep_organizer()  from public, anon, authenticated;
revoke all on function public.staff_invites_seat_limit()   from public, anon, authenticated;
revoke all on function public.seasons_single_current()     from public, anon, authenticated;

grant execute on function public.has_team_role(uuid, text[]) to authenticated;
grant execute on function public.is_team_staff(uuid)         to authenticated;
grant execute on function public.create_team(text, text, text, text, text) to authenticated;
grant execute on function public.accept_invite(uuid)         to authenticated;
grant execute on function public.invite_preview(uuid)        to anon, authenticated;
grant execute on function public.public_roster(uuid)         to anon, authenticated;
