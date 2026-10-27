-- =============================================================================
-- Team messages, league announcements, and push notifications.
-- =============================================================================
--   team_messages      three channels per team, adults only (players have no
--                      accounts):
--                        announcements  coaches post; the family reads
--                        families       staff and approved guardians talk
--                        staff          staff only
--                      No direct messages: every conversation is in a channel
--                      the coaches can see. Staff can take a message down; a
--                      removed message stays in the table (removed_at, by
--                      whom) for the league to review, and leaves every screen.
--   org_announcements  a league admin's message to every team in the league.
--   push_subscriptions one row per device that turned notifications on.
--   notify_settings    per person per team: which kinds to send. No row means
--                      everything on.
--   push_targets()     who to send to, for the server's own key only: it reads
--                      other people's devices, which no signed-in user may.
-- =============================================================================

create table public.team_messages (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams(id) on delete cascade,
  channel    text not null check (channel in ('announcements', 'families', 'staff')),
  user_id    uuid default auth.uid() references public.profiles(id) on delete set null,
  body       text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null
);
create index team_messages_team_idx on public.team_messages (team_id, channel, id desc);

create table public.org_announcements (
  id         bigint generated always as identity primary key,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid default auth.uid() references public.profiles(id) on delete set null,
  body       text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index org_announcements_org_idx on public.org_announcements (org_id, id desc);

create table public.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notify_settings (
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  team_id       uuid not null references public.teams(id) on delete cascade,
  announcements boolean not null default true,
  chat          boolean not null default true,
  schedule      boolean not null default true,
  games         boolean not null default true,
  primary key (user_id, team_id)
);

-- --------------------------------------------------------------- helpers ----
create function public.can_read_channel(p_team uuid, p_channel text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case p_channel when 'staff' then public.is_team_staff(p_team) else public.is_team_family(p_team) end;
$$;

create function public.can_post_channel(p_team uuid, p_channel text)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case p_channel
           when 'announcements' then public.has_team_role(p_team, array['organizer', 'head_coach', 'coach'])
           when 'staff' then public.is_team_staff(p_team)
           else public.is_team_family(p_team)
         end;
$$;

create function public.in_org_family(p_org uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select public.is_org_admin(p_org)
      or exists (select 1 from public.teams t where t.org_id = p_org and public.is_team_family(t.id));
$$;

-- Take a message down: its author, or the team's coaches.
create function public.remove_message(p_id bigint)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_msg public.team_messages;
begin
  select * into v_msg from public.team_messages where id = p_id;
  if v_msg.id is null or not (v_msg.user_id = auth.uid()
     or public.has_team_role(v_msg.team_id, array['organizer', 'head_coach', 'coach'])) then
    raise exception 'You cannot remove that message.' using errcode = '42501';
  end if;
  update public.team_messages set removed_at = now(), removed_by = auth.uid() where id = p_id and removed_at is null;
end;
$$;

-- The devices to notify. audience: 'family', 'staff', or 'followers' (family
-- and fans). kind picks the notify_settings column. The sender is left out.
create function public.push_targets(p_team uuid, p_audience text, p_kind text, p_except uuid default null)
returns table (endpoint text, p256dh text, auth text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  with people as (
    select user_id from public.team_staff where team_id = p_team
    union select m.user_id from public.org_members m join public.teams t on t.org_id = m.org_id
     where t.id = p_team and p_audience <> 'staff'
    union select user_id from public.team_members
     where team_id = p_team and status = 'active' and p_audience <> 'staff'
       and (role = 'guardian' or p_audience = 'followers')
  )
  select s.endpoint, s.p256dh, s.auth
    from people p join public.push_subscriptions s on s.user_id = p.user_id
    left join public.notify_settings n on n.user_id = p.user_id and n.team_id = p_team
   where p.user_id is distinct from p_except
     and coalesce(case p_kind when 'announcements' then n.announcements when 'chat' then n.chat
                              when 'schedule' then n.schedule when 'games' then n.games end, true);
$$;

-- ------------------------------------------------------------------- RLS ----
alter table public.team_messages      enable row level security;
alter table public.org_announcements  enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notify_settings    enable row level security;

create policy team_messages_read on public.team_messages for select to authenticated
  using (removed_at is null and public.can_read_channel(team_id, channel));
create policy team_messages_insert on public.team_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_post_channel(team_id, channel));

create policy org_announcements_read on public.org_announcements for select to authenticated
  using (public.in_org_family(org_id));
create policy org_announcements_insert on public.org_announcements for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_org_admin(org_id));
create policy org_announcements_delete on public.org_announcements for delete to authenticated
  using (public.is_org_admin(org_id));

create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notify_settings_own on public.notify_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.team_messages, public.org_announcements, public.push_subscriptions, public.notify_settings
  from anon, authenticated;
grant select on public.team_messages to authenticated;
grant insert (team_id, channel, body) on public.team_messages to authenticated;
grant select, delete on public.org_announcements to authenticated;
grant insert (org_id, body) on public.org_announcements to authenticated;
grant select, delete on public.push_subscriptions to authenticated;
grant insert (endpoint, p256dh, auth) on public.push_subscriptions to authenticated;
grant update (p256dh, auth) on public.push_subscriptions to authenticated;
grant select, delete on public.notify_settings to authenticated;
grant insert (team_id, announcements, chat, schedule, games) on public.notify_settings to authenticated;
grant update (announcements, chat, schedule, games) on public.notify_settings to authenticated;

revoke all on function public.can_read_channel(uuid, text)               from public, anon;
revoke all on function public.can_post_channel(uuid, text)               from public, anon;
revoke all on function public.in_org_family(uuid)                        from public, anon;
revoke all on function public.remove_message(bigint)                     from public, anon;
revoke all on function public.push_targets(uuid, text, text, uuid)       from public, anon, authenticated;
grant execute on function public.can_read_channel(uuid, text)            to authenticated;
grant execute on function public.can_post_channel(uuid, text)            to authenticated;
grant execute on function public.in_org_family(uuid)                     to authenticated;
grant execute on function public.remove_message(bigint)                  to authenticated;
grant execute on function public.push_targets(uuid, text, text, uuid)    to service_role;
