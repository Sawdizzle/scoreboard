-- =============================================================================
-- People: leagues, families, fans, and scorers for each game.
-- =============================================================================
-- Who is who, from the top:
--
--   organizations    a league (an org) with its own admins. A team joins one
--   org_members      through a team link from the org's admins. Org admins act
--   org_invites      as a team admin (organizer) on every team in the org.
--
--   team_staff       unchanged: the people who run a team. Five coaching seats
--                    (organizer, head_coach, coach, media); scorer seats no
--                    longer count toward the five, so a team can have as many
--                    parents scoring as it needs (twenty at most).
--
--   team_members     everyone else on a team. A guardian (parent) joins with
--                    the team's family link and waits for staff to approve;
--                    a fan follows a public team in one tap.
--   guardian_players which players a guardian is the parent of.
--   game_scorers     who is down to score which game. Only scoring staff can
--                    be put on a game: the seat is what lets them score.
--
-- "Family" below means the team's staff and its approved guardians. Fans are
-- followers: they get scores, not the team's messages or practices.
-- =============================================================================

-- ------------------------------------------------------------------ leagues ----
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,70}$'),
  name       text not null check (char_length(name) between 1 and 80),
  color      text not null default '#2f63cc' check (color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url   text check (logo_url is null or char_length(logo_url) <= 500),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'org_admin' check (role in ('org_admin')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on public.org_members (user_id);

-- 'admin' links are one use and make an org admin. 'team' links can be used by
-- any team admin who has one, to put their team in the org, until revoked.
create table public.org_invites (
  token      uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  kind       text not null check (kind in ('admin', 'team')),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  used_by    uuid references auth.users(id) on delete set null,
  used_at    timestamptz
);
create index org_invites_org_idx on public.org_invites (org_id);

alter table public.teams add column org_id uuid references public.organizations(id) on delete set null;
create index teams_org_idx on public.teams (org_id);

-- --------------------------------------------------------- families, fans ----
create table public.team_members (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('guardian', 'fan')),
  status     text not null default 'active' check (status in ('pending', 'active')),
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index team_members_user_idx on public.team_members (user_id);
comment on table public.team_members is
  'Parents and fans. A guardian joins pending through the family link; staff approve. A fan follows a public team.';

create table public.guardian_players (
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, player_id)
);
create index guardian_players_team_idx on public.guardian_players (team_id);

-- The family link. Its own table, since teams is readable by anyone and the
-- token is a secret.
create table public.team_family_links (
  team_id          uuid primary key references public.teams(id) on delete cascade,
  token            uuid not null unique default gen_random_uuid(),
  require_approval boolean not null default true
);
insert into public.team_family_links (team_id) select id from public.teams;

create function public.teams_family_link()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.team_family_links (team_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger teams_family_link after insert on public.teams
  for each row execute function public.teams_family_link();

create table public.game_scorers (
  game_id    uuid not null references public.games(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
create index game_scorers_user_idx on public.game_scorers (user_id);

-- --------------------------------------------------------------- helpers ----
create function public.is_org_admin(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = (select auth.uid()));
$$;

create function public.is_org_admin_of_team(p_team uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.teams t join public.org_members m on m.org_id = t.org_id
     where t.id = p_team and m.user_id = (select auth.uid())
  );
$$;

-- An org admin counts as a team's organizer, and so as its staff, everywhere
-- a policy asks.
create or replace function public.has_team_role(p_team uuid, p_roles text[])
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_staff s
     where s.team_id = p_team and s.user_id = (select auth.uid()) and s.role = any (p_roles)
  ) or ('organizer' = any (p_roles) and public.is_org_admin_of_team(p_team));
$$;

create or replace function public.is_team_staff(p_team uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_staff s
     where s.team_id = p_team and s.user_id = (select auth.uid())
  ) or public.is_org_admin_of_team(p_team);
$$;

create function public.is_team_guardian(p_team uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_members m
     where m.team_id = p_team and m.user_id = (select auth.uid()) and m.role = 'guardian' and m.status = 'active'
  );
$$;

-- Staff and approved guardians: who reads the team's messages and practices.
create function public.is_team_family(p_team uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_team_staff(p_team) or public.is_team_guardian(p_team);
$$;

-- A private team's games, stats and roster are open to its families too.
create or replace function public.team_visible(p_team uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select coalesce((select not t.private from public.teams t where t.id = p_team), false)
      or public.is_team_family(p_team);
$$;

-- Names are shown between people who share a team as staff or family, and
-- between org admins and the staff of their org's teams. Fans see nobody's.
create or replace function public.shares_team(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  with mine as (
    select team_id from public.team_staff where user_id = (select auth.uid())
    union select team_id from public.team_members
     where user_id = (select auth.uid()) and role = 'guardian' and status = 'active'
    union select t.id from public.teams t join public.org_members m on m.org_id = t.org_id
     where m.user_id = (select auth.uid())
  ), theirs as (
    select team_id from public.team_staff where user_id = p_user
    union select team_id from public.team_members
     where user_id = p_user and role = 'guardian'
  )
  select exists (select 1 from mine join theirs using (team_id))
      or exists (select 1 from public.org_members a join public.org_members b using (org_id)
                  where a.user_id = (select auth.uid()) and b.user_id = p_user);
$$;

-- --------------------------------------------------------- scorer seats ----
-- Five coaching seats; scorers are counted apart, up to twenty. A role change
-- into a coaching seat is counted too, so scorer cannot be a way past five.
create or replace function public.team_staff_seat_limit()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (new.role = old.role or (new.role <> 'scorer') = (old.role <> 'scorer')) then
    return new;
  end if;
  perform 1 from public.teams where id = new.team_id for update;
  if new.role = 'scorer' then
    if (select count(*) from public.team_staff where team_id = new.team_id and role = 'scorer') >= 20 then
      raise exception 'This team already has twenty scorers.' using errcode = 'P0001';
    end if;
  elsif (select count(*) from public.team_staff where team_id = new.team_id and role <> 'scorer') >= 5 then
    raise exception 'This team already has five staff.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger team_staff_seat_limit_role before update of role on public.team_staff
  for each row execute function public.team_staff_seat_limit();

create or replace function public.staff_invites_seat_limit()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_scorer boolean := new.role = 'scorer';
begin
  perform 1 from public.teams where id = new.team_id for update;
  if (select count(*) from public.team_staff where team_id = new.team_id and (role = 'scorer') = v_scorer)
     + (select count(*) from public.staff_invites
         where team_id = new.team_id and (role = 'scorer') = v_scorer and used_at is null and expires_at > now())
     >= (case when v_scorer then 20 else 5 end) then
    raise exception '%', (case when v_scorer then 'All twenty scorer seats are filled or have a link out.'
                               else 'All five seats are filled or have a link out.' end) using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop function public.invite_preview(uuid);
create function public.invite_preview(p_token uuid)
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
                  where s.team_id = i.team_id and (s.role = 'scorer') = (i.role = 'scorer'))
                >= case when i.role = 'scorer' then 20 else 5 end then 'full'
           else 'open'
         end
    from public.staff_invites i
    join public.teams t on t.id = i.team_id
   where i.token = p_token;
$$;
revoke all on function public.invite_preview(uuid) from public;
grant execute on function public.invite_preview(uuid) to anon, authenticated;

-- A scorer on a game must hold a seat that can score it.
create function public.game_scorers_check()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.team_staff s join public.games g on g.team_id = s.team_id
     where g.id = new.game_id and s.user_id = new.user_id and s.role <> 'media'
  ) then
    raise exception 'Only staff who can score can be put on a game. Give them a scorer seat first.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger game_scorers_check before insert on public.game_scorers
  for each row execute function public.game_scorers_check();

-- ---------------------------------------------------------- one-admin rule ----
create function public.org_members_keep_admin()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.organizations where id = old.org_id) then return old; end if;
  if not exists (select 1 from public.profiles where id = old.user_id) then return old; end if;
  perform 1 from public.organizations where id = old.org_id for update;
  if not exists (select 1 from public.org_members where org_id = old.org_id and user_id <> old.user_id) then
    raise exception 'A league needs an admin. Add another admin first.' using errcode = 'P0001';
  end if;
  return old;
end;
$$;
create trigger org_members_keep_admin before delete on public.org_members
  for each row execute function public.org_members_keep_admin();

-- ------------------------------------------------------------------- RPC ----
create function public.create_org(p_name text, p_slug text)
returns public.organizations
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_org public.organizations;
begin
  if v_uid is null then
    raise exception 'Sign in to create a league.' using errcode = '42501';
  end if;
  if exists (select 1 from public.organizations where slug = p_slug) then
    raise exception 'That league address is taken. Try another.' using errcode = 'P0001';
  end if;
  insert into public.organizations (slug, name, created_by) values (p_slug, trim(p_name), v_uid) returning * into v_org;
  insert into public.org_members (org_id, user_id) values (v_org.id, v_uid);
  return v_org;
end;
$$;

create function public.org_invite_preview(p_token uuid)
returns table (org_name text, org_color text, kind text, state text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select o.name, o.color, i.kind,
         case
           when i.used_at is not null then 'used'
           when i.expires_at <= now() then 'expired'
           else 'open'
         end
    from public.org_invites i join public.organizations o on o.id = i.org_id
   where i.token = p_token;
$$;

-- An admin link makes the caller an org admin. A team link puts p_team, which
-- the caller must be a team admin of (a real seat, not through another org),
-- in the org. Returns the org's slug.
create function public.accept_org_invite(p_token uuid, p_team uuid default null)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.org_invites;
begin
  if v_uid is null then
    raise exception 'Sign in to accept this invite.' using errcode = '42501';
  end if;
  select * into v_inv from public.org_invites where token = p_token for update;
  if v_inv.token is null then
    raise exception 'This invite link is not valid.' using errcode = 'P0001';
  end if;
  if v_inv.used_at is not null then
    raise exception 'This invite link was already used.' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invite link has expired. Ask for a new one.' using errcode = 'P0001';
  end if;
  if v_inv.kind = 'admin' then
    insert into public.org_members (org_id, user_id) values (v_inv.org_id, v_uid) on conflict do nothing;
    update public.org_invites set used_by = v_uid, used_at = now() where token = p_token;
  else
    if not exists (select 1 from public.team_staff where team_id = p_team and user_id = v_uid and role = 'organizer') then
      raise exception 'Only a team admin can put the team in a league.' using errcode = 'P0001';
    end if;
    update public.teams set org_id = v_inv.org_id where id = p_team;
  end if;
  return (select slug from public.organizations where id = v_inv.org_id);
end;
$$;

-- Out of the league: by its org admins, or by the team's own admin.
create function public.leave_org(p_team uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_org_admin_of_team(p_team)
          or exists (select 1 from public.team_staff where team_id = p_team and user_id = auth.uid() and role = 'organizer')) then
    raise exception 'Only the league or the team admin can do that.' using errcode = '42501';
  end if;
  update public.teams set org_id = null where id = p_team;
end;
$$;

-- What a family link is for, before sign-in, with the roster to pick a child
-- from (first name and last initial: the link is a secret held by families).
create function public.family_preview(p_token uuid)
returns jsonb
language sql stable security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'team_id', t.id, 'slug', t.slug, 'name', t.name, 'display_name', t.display_name, 'color', t.color,
    'color2', t.color2, 'logo_url', t.logo_url, 'age_group', t.age_group, 'approval', l.require_approval,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'number', p.number,
               'name', trim(p.first_name || ' ' || case when p.last_name <> '' then left(p.last_name, 1) || '.' else '' end))
               order by nullif(p.number, '')::int nulls last, p.first_name)
        from public.players p where p.team_id = t.id and p.active), '[]'::jsonb))
    from public.team_family_links l join public.teams t on t.id = l.team_id
   where l.token = p_token;
$$;

-- Join as a parent of the chosen players. Pending until staff approve, unless
-- the team turned approval off. A fan who joins this way becomes a guardian.
create function public.join_family(p_token uuid, p_players uuid[])
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_link public.team_family_links;
begin
  if v_uid is null then
    raise exception 'Sign in to join the team.' using errcode = '42501';
  end if;
  select * into v_link from public.team_family_links where token = p_token;
  if v_link.team_id is null then
    raise exception 'This family link is not valid. Ask the coach for the new one.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_players, 1), 0) = 0 then
    raise exception 'Pick your player.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(p_players) x where not exists
              (select 1 from public.players p where p.id = x and p.team_id = v_link.team_id)) then
    raise exception 'That player is not on this team.' using errcode = 'P0001';
  end if;
  insert into public.team_members (team_id, user_id, role, status)
  values (v_link.team_id, v_uid, 'guardian', case when v_link.require_approval then 'pending' else 'active' end)
  on conflict (team_id, user_id) do update set role = 'guardian',
    status = case when team_members.role = 'guardian' then team_members.status else excluded.status end;
  insert into public.guardian_players (team_id, user_id, player_id)
  select v_link.team_id, v_uid, x from unnest(p_players) x on conflict do nothing;
  return (select slug from public.teams where id = v_link.team_id);
end;
$$;

create function public.follow_team(p_team uuid)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in to follow the team.' using errcode = '42501';
  end if;
  if coalesce((select private from public.teams where id = p_team), true) then
    raise exception 'This team is private.' using errcode = 'P0001';
  end if;
  insert into public.team_members (team_id, user_id, role) values (p_team, auth.uid(), 'fan')
  on conflict do nothing;
end;
$$;

create function public.rotate_family_link(p_team uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_token uuid;
begin
  if not public.has_team_role(p_team, array['organizer', 'head_coach', 'coach']) then
    raise exception 'Your seat on this team cannot do that.' using errcode = '42501';
  end if;
  update public.team_family_links set token = gen_random_uuid() where team_id = p_team returning token into v_token;
  return v_token;
end;
$$;

-- ------------------------------------------------------------------- RLS ----
alter table public.organizations     enable row level security;
alter table public.org_members       enable row level security;
alter table public.org_invites       enable row level security;
alter table public.team_members      enable row level security;
alter table public.guardian_players  enable row level security;
alter table public.team_family_links enable row level security;
alter table public.game_scorers      enable row level security;

-- A league's name is public: a team page can say which league it plays in.
create policy organizations_read on public.organizations for select using (true);
create policy organizations_update on public.organizations for update
  using (public.is_org_admin(id)) with check (public.is_org_admin(id));
create policy organizations_delete on public.organizations for delete using (public.is_org_admin(id));

create policy org_members_read on public.org_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_org_admin(org_id));
create policy org_members_delete on public.org_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_org_admin(org_id));

create policy org_invites_read on public.org_invites for select to authenticated using (public.is_org_admin(org_id));
create policy org_invites_insert on public.org_invites for insert to authenticated
  with check (public.is_org_admin(org_id) and created_by = (select auth.uid()));
create policy org_invites_delete on public.org_invites for delete to authenticated using (public.is_org_admin(org_id));

-- Staff see everyone on their team; a member sees their own row.
create policy team_members_read on public.team_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_team_staff(team_id));
create policy team_members_update on public.team_members for update to authenticated
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']))
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));
create policy team_members_delete on public.team_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));

create policy guardian_players_read on public.guardian_players for select to authenticated
  using (user_id = (select auth.uid()) or public.is_team_staff(team_id));
create policy guardian_players_insert on public.guardian_players for insert to authenticated
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach'])
              and exists (select 1 from public.players p where p.id = player_id and p.team_id = guardian_players.team_id));
create policy guardian_players_delete on public.guardian_players for delete to authenticated
  using (user_id = (select auth.uid()) or public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));

create policy team_family_links_read on public.team_family_links for select to authenticated
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));
create policy team_family_links_update on public.team_family_links for update to authenticated
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']))
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));

-- A guardian reads their own players' rows, so their child's card and stats open.
create policy players_read_guardian on public.players for select to authenticated
  using (public.is_team_guardian(team_id)
         and exists (select 1 from public.guardian_players g where g.player_id = players.id and g.user_id = (select auth.uid())));

create policy game_scorers_read on public.game_scorers for select to authenticated
  using (public.is_team_family(public.game_team(game_id)));
create policy game_scorers_insert on public.game_scorers for insert to authenticated
  with check (public.has_team_role(public.game_team(game_id), array['organizer', 'head_coach', 'coach']));
create policy game_scorers_delete on public.game_scorers for delete to authenticated
  using (user_id = (select auth.uid()) or public.has_team_role(public.game_team(game_id), array['organizer', 'head_coach', 'coach']));

-- ---------------------------------------------------------------- grants ----
revoke all on public.organizations, public.org_members, public.org_invites, public.team_members,
              public.guardian_players, public.team_family_links, public.game_scorers from anon, authenticated;
grant select on public.organizations to anon, authenticated;
grant update (name, color, logo_url) on public.organizations to authenticated;
grant delete on public.organizations to authenticated;
grant select, delete on public.org_members to authenticated;
grant select, delete on public.org_invites to authenticated;
grant insert (org_id, kind) on public.org_invites to authenticated;
grant select, delete on public.team_members to authenticated;
grant update (status) on public.team_members to authenticated;
grant select, delete on public.guardian_players to authenticated;
grant insert (team_id, user_id, player_id) on public.guardian_players to authenticated;
grant select on public.team_family_links to authenticated;
grant update (require_approval) on public.team_family_links to authenticated;
grant select, delete on public.game_scorers to authenticated;
grant insert (game_id, user_id) on public.game_scorers to authenticated;

revoke all on function public.is_org_admin(uuid)            from public, anon;
revoke all on function public.is_org_admin_of_team(uuid)    from public, anon;
revoke all on function public.is_team_guardian(uuid)        from public, anon;
revoke all on function public.is_team_family(uuid)          from public, anon;
revoke all on function public.create_org(text, text)        from public, anon;
revoke all on function public.org_invite_preview(uuid)      from public;
revoke all on function public.accept_org_invite(uuid, uuid) from public, anon;
revoke all on function public.leave_org(uuid)               from public, anon;
revoke all on function public.family_preview(uuid)          from public;
revoke all on function public.join_family(uuid, uuid[])     from public, anon;
revoke all on function public.follow_team(uuid)             from public, anon;
revoke all on function public.rotate_family_link(uuid)      from public, anon;
revoke all on function public.teams_family_link()           from public, anon, authenticated;
revoke all on function public.game_scorers_check()          from public, anon, authenticated;
revoke all on function public.org_members_keep_admin()      from public, anon, authenticated;

grant execute on function public.is_org_admin(uuid)            to authenticated;
grant execute on function public.is_org_admin_of_team(uuid)    to authenticated;
grant execute on function public.is_team_guardian(uuid)        to authenticated;
grant execute on function public.is_team_family(uuid)          to authenticated;
grant execute on function public.create_org(text, text)        to authenticated;
grant execute on function public.org_invite_preview(uuid)      to anon, authenticated;
grant execute on function public.accept_org_invite(uuid, uuid) to authenticated;
grant execute on function public.leave_org(uuid)               to authenticated;
grant execute on function public.family_preview(uuid)          to anon, authenticated;
grant execute on function public.join_family(uuid, uuid[])     to authenticated;
grant execute on function public.follow_team(uuid)             to authenticated;
grant execute on function public.rotate_family_link(uuid)      to authenticated;

-- ---------------------------------------------------------- sign-up gate ----
-- A family link or a league invite lets a sign-up through the invite-code gate,
-- as a staff invite does.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_meta jsonb := coalesce(event->'user'->'user_metadata', event->'user'->'raw_user_meta_data', '{}');
begin
  select value into v_code from private.settings where key = 'invite_code';
  if coalesce(v_code, '') = ''
     or v_meta->>'invite_code' = v_code
     or exists (select 1 from public.staff_invites i
                 where i.token::text = v_meta->>'staff_invite' and i.used_at is null and i.expires_at > now())
     or exists (select 1 from public.team_family_links l where l.token::text = v_meta->>'family_invite')
     or exists (select 1 from public.org_invites i
                 where i.token::text = v_meta->>'org_invite' and i.used_at is null and i.expires_at > now()) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'Sign-up needs an invite code.'));
end;
$$;
