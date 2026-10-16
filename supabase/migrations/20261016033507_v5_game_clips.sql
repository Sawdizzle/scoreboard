-- =============================================================================
-- Game clips: every replay-buffer save the stream asked OBS for, logged.
-- =============================================================================
-- The overlay already saves OBS's replay buffer after a big moment
-- (auto-clip) or when the pad taps Save replay. The file lands on the
-- streaming computer; until now nothing remembered which moment it was. Each
-- save is now a row: what it was for, the inning and score, when the moment
-- happened and whether OBS said it saved. The game page reads them, places
-- each one in the stream by stream_sessions, and the YouTube description
-- lists them as highlights.
--
-- The overlay runs signed out, so it writes through clip_report(token), as it
-- does obs_report. `n` is the overlay's own key for the save, so a second
-- report (armed, then saved) updates the same row.
--
-- A clip whose play is undone: the overlay sees the undo. Before the save it
-- just never saves; after it, it reports the clip discarded. The file on disk
-- is never touched.
-- =============================================================================

create table public.game_clips (
  id          bigint generated always as identity primary key,
  team_id     uuid not null references public.teams(id) on delete cascade,
  game_id     uuid references public.games(id) on delete cascade,
  n           bigint not null,
  kind        text not null check (char_length(kind) between 1 and 24),
  kinds       text[] not null default '{}' check (cardinality(kinds) <= 8),
  source      text not null default 'auto' check (source in ('auto', 'manual')),
  seq         int,
  inning      int check (inning is null or inning between 0 and 99),
  half        text check (half is null or half in ('top', 'bottom')),
  away_score  int check (away_score is null or away_score between 0 and 999),
  home_score  int check (home_score is null or home_score between 0 and 999),
  moment_at   timestamptz not null default now(),
  status      text not null default 'armed' check (status in ('armed', 'asked', 'saved', 'missed', 'discarded')),
  code        text check (code is null or char_length(code) <= 24),
  saved_at    timestamptz,
  created_at  timestamptz not null default now(),
  unique (team_id, n)
);
create index game_clips_game_idx on public.game_clips (game_id, moment_at);
comment on table public.game_clips is
  'Each replay-buffer save the stream asked OBS for: the moment, the inning and score, and whether OBS saved it.';

alter table public.game_clips enable row level security;
create policy game_clips_read on public.game_clips for select using (public.is_team_staff(team_id));
revoke all on public.game_clips from anon, authenticated;
grant select on public.game_clips to authenticated;

-- The overlay's report of one save. Unknown token, a game of another team or
-- a malformed report: nothing happens. A row only moves forward
-- (armed → asked → saved or missed), so a late "armed" never undoes "saved".
create or replace function public.clip_report(p_token uuid, p_clip jsonb)
returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_team uuid;
  v_game uuid;
  v_n bigint;
  v_status text := p_clip->>'status';
  v_kinds text[];
begin
  if jsonb_typeof(p_clip) <> 'object' or pg_column_size(p_clip) >= 4000 then return; end if;
  if v_status is null or v_status not in ('armed', 'asked', 'saved', 'missed', 'discarded') then return; end if;
  if jsonb_typeof(p_clip->'n') <> 'number' then return; end if;
  v_n := (p_clip->>'n')::numeric::bigint;
  select c.team_id into v_team from public.channels c where c.token = p_token;
  if v_team is null then return; end if;
  if p_clip->>'game_id' ~* '^[0-9a-f-]{36}$' then
    select g.id into v_game from public.games g where g.id = (p_clip->>'game_id')::uuid and g.team_id = v_team;
  end if;
  -- A runaway page can't fill the table: 400 clips a game is far past any real one.
  if v_game is not null and (select count(*) from public.game_clips where game_id = v_game) >= 400 then return; end if;
  if jsonb_typeof(p_clip->'kinds') = 'array' then
    select array_agg(left(k, 24)) into v_kinds from (select jsonb_array_elements_text(p_clip->'kinds') k limit 8) s;
  end if;

  insert into public.game_clips as gc (team_id, game_id, n, kind, kinds, source, seq, inning, half, away_score, home_score, moment_at, status, code, saved_at)
  values (
    v_team, v_game, v_n,
    left(coalesce(nullif(p_clip->>'kind', ''), 'clip'), 24),
    coalesce(v_kinds, '{}'),
    case when p_clip->>'source' = 'manual' then 'manual' else 'auto' end,
    case when jsonb_typeof(p_clip->'seq') = 'number' then (p_clip->>'seq')::int end,
    case when jsonb_typeof(p_clip->'inning') = 'number' then least(greatest((p_clip->>'inning')::int, 0), 99) end,
    case when p_clip->>'half' in ('top', 'bottom') then p_clip->>'half' end,
    case when jsonb_typeof(p_clip->'away') = 'number' then least(greatest((p_clip->>'away')::int, 0), 999) end,
    case when jsonb_typeof(p_clip->'home') = 'number' then least(greatest((p_clip->>'home')::int, 0), 999) end,
    -- The moment is when the overlay heard it, never more than a day off now.
    case when jsonb_typeof(p_clip->'n') = 'number' and abs(v_n - extract(epoch from now()) * 1000) < 86400000
      then to_timestamp(v_n / 1000.0) else now() end,
    v_status, left(p_clip->>'code', 24),
    case when v_status = 'saved' then now() end
  )
  on conflict (team_id, n) do update set
    status = case
      when excluded.status = 'discarded' then 'discarded'
      when gc.status in ('saved', 'missed', 'discarded') then gc.status
      when gc.status = 'asked' and excluded.status = 'armed' then gc.status
      else excluded.status end,
    code = case when excluded.status = 'discarded' then excluded.code when gc.status in ('saved', 'missed', 'discarded') then gc.code else excluded.code end,
    kind = case when gc.status = 'armed' and nullif(p_clip->>'kind', '') is not null then excluded.kind else gc.kind end,
    kinds = case when gc.status = 'armed' and cardinality(excluded.kinds) > 0 then excluded.kinds else gc.kinds end,
    saved_at = coalesce(gc.saved_at, excluded.saved_at);
end;
$$;
revoke all on function public.clip_report(uuid, jsonb) from public;
grant execute on function public.clip_report(uuid, jsonb) to anon, authenticated;
