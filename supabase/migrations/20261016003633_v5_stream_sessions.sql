-- =============================================================================
-- Stream sessions: when the stream went live and when it stopped.
-- =============================================================================
-- OBS reports its status through the Browser Source (obs_report), but only
-- the latest status was kept. A game video's chapters need the moment the
-- stream started, so each start and stop is now kept as a session.
--
-- Only OBS with "read" access or more reports streaming at all; with none,
-- there are no sessions and the YouTube helper asks where first pitch is.
-- =============================================================================

create table public.stream_sessions (
  id         bigint generated always as identity primary key,
  team_id    uuid not null references public.teams(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
create index stream_sessions_team_idx on public.stream_sessions (team_id, started_at);
comment on table public.stream_sessions is
  'Each time a team''s OBS went live and stopped, as its Browser Source reported it.';
alter table public.stream_sessions enable row level security;
create policy stream_sessions_read on public.stream_sessions for select using (public.is_team_staff(team_id));
revoke all on public.stream_sessions from anon, authenticated;
grant select on public.stream_sessions to authenticated;

create or replace function public.obs_report(p_token uuid, p_obs jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team uuid;
  v_open boolean;
  v_now boolean := case when jsonb_typeof(p_obs->'streaming') = 'boolean' then (p_obs->>'streaming')::boolean end;
begin
  if jsonb_typeof(p_obs) <> 'object' or pg_column_size(p_obs) >= 16000 then return; end if;
  select c.team_id into v_team from public.channels c where c.token = p_token;
  if v_team is null then return; end if;
  v_open := exists (select 1 from public.stream_sessions where team_id = v_team and ended_at is null);
  insert into public.channel_obs (team_id, obs, at) values (v_team, p_obs, now())
  on conflict (team_id) do update set obs = excluded.obs, at = excluded.at;
  -- Streaming with no open session opens one; stopped with one open closes
  -- it. An unknown status (null: OBS gave no read access) changes nothing.
  if v_now is true and not v_open then
    insert into public.stream_sessions (team_id) values (v_team);
  elsif v_now is false and v_open then
    update public.stream_sessions set ended_at = now() where team_id = v_team and ended_at is null;
  end if;
end;
$$;
