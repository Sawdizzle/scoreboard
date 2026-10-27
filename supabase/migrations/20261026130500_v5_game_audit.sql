-- =============================================================================
-- Wiping a game leaves a record, and a final game is the organizer's to wipe.
-- =============================================================================
-- reset_game() (every play gone, back to scheduled) was open to any scoring
-- seat, and neither it nor deleting a game left any trace. Now:
--   * a final game can be reset or deleted by an organizer only (later: a
--     league admin); before the final, the seats that could still can
--   * every reset and every delete first writes a game_audit row: who, when,
--     what, and the game as it stood (status, score state, how many plays)
-- game_audit has no foreign keys, so the row outlives the game and the team.
-- The team's staff read it; nobody writes it except these functions.
-- =============================================================================

create table public.game_audit (
  id         bigint generated always as identity primary key,
  game_id    uuid not null,
  team_id    uuid not null,
  action     text not null check (action in ('reset', 'delete')),
  actor      uuid default auth.uid(),
  at         timestamptz not null default now(),
  snapshot   jsonb not null default '{}'
);
create index game_audit_team_idx on public.game_audit (team_id, at);
comment on table public.game_audit is
  'One row per game reset or delete: who, when, and the game as it stood. Written by reset_game() and a trigger on games.';

alter table public.game_audit enable row level security;
create policy game_audit_read on public.game_audit for select to authenticated
  using (public.is_team_staff(team_id));
grant select on public.game_audit to authenticated;

create function private.game_snapshot(g public.games)
returns jsonb
language sql stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object('status', g.status, 'seq', g.seq, 'live', g.live, 'opponent_name', g.opponent_name,
           'starts_at', g.starts_at, 'plays', (select count(*) from public.game_events e where e.game_id = g.id));
$$;

create function private.games_audit_delete()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.game_audit (game_id, team_id, action, snapshot)
  values (old.id, old.team_id, 'delete', private.game_snapshot(old));
  return old;
end;
$$;
create trigger games_audit_delete before delete on public.games
  for each row execute function private.games_audit_delete();

-- A final game: organizers only.
alter policy games_delete on public.games
  using (public.has_team_role(team_id, array['organizer', 'head_coach'])
         and (status <> 'final' or public.has_team_role(team_id, array['organizer'])));

create or replace function public.reset_game(p_game uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if g.id is null then
    raise exception 'That game does not exist.' using errcode = 'P0001';
  end if;
  if not public.has_team_role(g.team_id, array['organizer', 'head_coach', 'coach', 'scorer']) then
    raise exception 'Your seat cannot score this game.' using errcode = '42501';
  end if;
  if g.status = 'final' and not public.has_team_role(g.team_id, array['organizer']) then
    raise exception 'This game is final. Only an organizer can reset it.' using errcode = 'P0001';
  end if;
  insert into public.game_audit (game_id, team_id, action, snapshot)
  values (g.id, g.team_id, 'reset', private.game_snapshot(g));
  delete from public.game_events where game_id = p_game;
  update public.games set live = '{}', status = 'scheduled', clock = null, seq = g.seq + 1 where id = p_game;
  return jsonb_build_object('seq', g.seq + 1, 'live', '{}'::jsonb, 'status', 'scheduled');
end;
$$;

revoke all on function private.game_snapshot(public.games) from public, anon, authenticated;
revoke all on function private.games_audit_delete() from public, anon, authenticated;
