-- =============================================================================
-- Stage 2a — season stats, and GameChanger imports.
-- =============================================================================
-- A player's season line is the sum of everything known about it. Today that
-- is one source: a GameChanger season export, imported per season. When the
-- pad starts scoring games (Stage 2c), its plays add a second source, and
-- season_stats is redefined to add the two; nothing that reads it changes.
--
-- An import is a snapshot of the games GameChanger scored, so importing the
-- same season again replaces the last import rather than adding to it. Games
-- scored in Pressbox are never in a GameChanger export, so the two never
-- count the same game twice as long as a game is scored in one place.
--
-- Rows hold counts only; the rates (AVG, OBP, ERA ...) are worked out where
-- they are shown, from the same counts, so a rate can never disagree with the
-- numbers beside it.
--
-- Who sees what: season stats are public, like the team page they appear on.
-- They name a player by id only; the name comes from public_roster(), which
-- applies the player's own public-name setting.
-- =============================================================================

-- How many innings a game has, for ERA. Youth baseball plays 6 or 7, and an
-- ERA quoted per 9 makes a 12-year-old look like a disaster. GameChanger's
-- youth default is 7.
alter table public.seasons add column game_innings smallint not null default 7
  check (game_innings between 3 and 9);
grant update (game_innings) on public.seasons to authenticated;
grant insert (game_innings) on public.seasons to authenticated;

create table public.stat_imports (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  season_id   uuid not null references public.seasons(id) on delete cascade,
  player_id   uuid not null references public.players(id) on delete cascade,
  source      text not null default 'gamechanger' check (source in ('gamechanger')),
  imported_at timestamptz not null default now(),
  imported_by uuid default auth.uid() references auth.users(id) on delete set null,

  -- batting
  b_g    int not null default 0 check (b_g >= 0),
  b_pa   int not null default 0 check (b_pa >= 0),
  b_ab   int not null default 0 check (b_ab >= 0),
  b_h    int not null default 0 check (b_h >= 0),
  b_2b   int not null default 0 check (b_2b >= 0),
  b_3b   int not null default 0 check (b_3b >= 0),
  b_hr   int not null default 0 check (b_hr >= 0),
  b_rbi  int not null default 0 check (b_rbi >= 0),
  b_r    int not null default 0 check (b_r >= 0),
  b_bb   int not null default 0 check (b_bb >= 0),
  b_so   int not null default 0 check (b_so >= 0),
  b_kl   int not null default 0 check (b_kl >= 0),
  b_hbp  int not null default 0 check (b_hbp >= 0),
  b_sac  int not null default 0 check (b_sac >= 0),
  b_sf   int not null default 0 check (b_sf >= 0),
  b_roe  int not null default 0 check (b_roe >= 0),
  b_fc   int not null default 0 check (b_fc >= 0),
  b_sb   int not null default 0 check (b_sb >= 0),
  b_cs   int not null default 0 check (b_cs >= 0),

  -- pitching. Innings are kept as outs: GameChanger's "9.2" is 29 outs, and
  -- 9.2 + 0.2 must come out 10.1, not 9.4.
  p_g      int not null default 0 check (p_g >= 0),
  p_gs     int not null default 0 check (p_gs >= 0),
  p_outs   int not null default 0 check (p_outs >= 0),
  p_bf     int not null default 0 check (p_bf >= 0),
  p_pitches int not null default 0 check (p_pitches >= 0),
  p_w      int not null default 0 check (p_w >= 0),
  p_l      int not null default 0 check (p_l >= 0),
  p_sv     int not null default 0 check (p_sv >= 0),
  p_h      int not null default 0 check (p_h >= 0),
  p_r      int not null default 0 check (p_r >= 0),
  p_er     int not null default 0 check (p_er >= 0),
  p_bb     int not null default 0 check (p_bb >= 0),
  p_so     int not null default 0 check (p_so >= 0),
  p_hbp    int not null default 0 check (p_hbp >= 0),
  p_wp     int not null default 0 check (p_wp >= 0),
  p_bk     int not null default 0 check (p_bk >= 0),

  unique (season_id, player_id, source)
);
create index stat_imports_team_idx on public.stat_imports (team_id);
create index stat_imports_player_idx on public.stat_imports (player_id);
comment on table public.stat_imports is
  'Season totals brought in from another scorer (GameChanger). One row per player per season per source; a re-import replaces it.';

-- The season and the player must both belong to the row's team: a row that
-- points one team's player at another team's season is refused.
create function public.stat_imports_same_team()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.seasons where id = new.season_id and team_id = new.team_id)
     or not exists (select 1 from public.players where id = new.player_id and team_id = new.team_id) then
    raise exception 'That season or player is not on this team.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger stat_imports_same_team before insert or update on public.stat_imports
  for each row execute function public.stat_imports_same_team();

-- A season's line per player, every source added up. security_invoker, so it
-- reads stat_imports under the caller's own policies.
create view public.season_stats with (security_invoker = true) as
select team_id, season_id, player_id,
       sum(b_g)::int b_g, sum(b_pa)::int b_pa, sum(b_ab)::int b_ab, sum(b_h)::int b_h, sum(b_2b)::int b_2b, sum(b_3b)::int b_3b,
       sum(b_hr)::int b_hr, sum(b_rbi)::int b_rbi, sum(b_r)::int b_r, sum(b_bb)::int b_bb, sum(b_so)::int b_so, sum(b_kl)::int b_kl,
       sum(b_hbp)::int b_hbp, sum(b_sac)::int b_sac, sum(b_sf)::int b_sf, sum(b_roe)::int b_roe, sum(b_fc)::int b_fc,
       sum(b_sb)::int b_sb, sum(b_cs)::int b_cs,
       sum(p_g)::int p_g, sum(p_gs)::int p_gs, sum(p_outs)::int p_outs, sum(p_bf)::int p_bf, sum(p_pitches)::int p_pitches,
       sum(p_w)::int p_w, sum(p_l)::int p_l, sum(p_sv)::int p_sv, sum(p_h)::int p_h, sum(p_r)::int p_r, sum(p_er)::int p_er,
       sum(p_bb)::int p_bb, sum(p_so)::int p_so, sum(p_hbp)::int p_hbp, sum(p_wp)::int p_wp, sum(p_bk)::int p_bk,
       max(imported_at) imported_at
  from public.stat_imports
 group by team_id, season_id, player_id;
comment on view public.season_stats is
  'Counting stats per player per season, every source added. Rates are computed by the app from these counts.';

-- Replace a season's GameChanger import in one transaction: the old rows go,
-- the new ones arrive, or neither happens. SECURITY INVOKER: the policies
-- below decide whether the caller may do either.
--
-- p_rows is an array of objects keyed by the column names above, each with a
-- player_id. Unknown keys are ignored; missing counts are 0.
create function public.import_season_stats(p_season uuid, p_rows jsonb)
returns int
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_team uuid;
  v_count int;
begin
  select team_id into v_team from public.seasons where id = p_season;
  if v_team is null then
    raise exception 'That season does not exist.' using errcode = 'P0001';
  end if;
  if not public.has_team_role(v_team, array['organizer', 'head_coach']) then
    raise exception 'Only an organizer or head coach can import stats.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 60 then
    raise exception 'An import is a list of at most 60 players.' using errcode = 'P0001';
  end if;

  delete from public.stat_imports where season_id = p_season and source = 'gamechanger';

  insert into public.stat_imports (team_id, season_id, player_id, source,
    b_g, b_pa, b_ab, b_h, b_2b, b_3b, b_hr, b_rbi, b_r, b_bb, b_so, b_kl, b_hbp, b_sac, b_sf, b_roe, b_fc, b_sb, b_cs,
    p_g, p_gs, p_outs, p_bf, p_pitches, p_w, p_l, p_sv, p_h, p_r, p_er, p_bb, p_so, p_hbp, p_wp, p_bk)
  select v_team, p_season, (r ->> 'player_id')::uuid, 'gamechanger',
    coalesce((r->>'b_g')::int, 0), coalesce((r->>'b_pa')::int, 0), coalesce((r->>'b_ab')::int, 0),
    coalesce((r->>'b_h')::int, 0), coalesce((r->>'b_2b')::int, 0), coalesce((r->>'b_3b')::int, 0),
    coalesce((r->>'b_hr')::int, 0), coalesce((r->>'b_rbi')::int, 0), coalesce((r->>'b_r')::int, 0),
    coalesce((r->>'b_bb')::int, 0), coalesce((r->>'b_so')::int, 0), coalesce((r->>'b_kl')::int, 0),
    coalesce((r->>'b_hbp')::int, 0), coalesce((r->>'b_sac')::int, 0), coalesce((r->>'b_sf')::int, 0),
    coalesce((r->>'b_roe')::int, 0), coalesce((r->>'b_fc')::int, 0), coalesce((r->>'b_sb')::int, 0),
    coalesce((r->>'b_cs')::int, 0),
    coalesce((r->>'p_g')::int, 0), coalesce((r->>'p_gs')::int, 0), coalesce((r->>'p_outs')::int, 0),
    coalesce((r->>'p_bf')::int, 0), coalesce((r->>'p_pitches')::int, 0), coalesce((r->>'p_w')::int, 0),
    coalesce((r->>'p_l')::int, 0), coalesce((r->>'p_sv')::int, 0), coalesce((r->>'p_h')::int, 0),
    coalesce((r->>'p_r')::int, 0), coalesce((r->>'p_er')::int, 0), coalesce((r->>'p_bb')::int, 0),
    coalesce((r->>'p_so')::int, 0), coalesce((r->>'p_hbp')::int, 0), coalesce((r->>'p_wp')::int, 0),
    coalesce((r->>'p_bk')::int, 0)
  from jsonb_array_elements(p_rows) r;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ------------------------------------------------------------------- RLS ----
alter table public.stat_imports enable row level security;
create policy stat_imports_read   on public.stat_imports for select using (true);
create policy stat_imports_insert on public.stat_imports for insert
  with check (public.has_team_role(team_id, array['organizer', 'head_coach']));
create policy stat_imports_delete on public.stat_imports for delete
  using (public.has_team_role(team_id, array['organizer', 'head_coach']));

revoke all on public.stat_imports from anon, authenticated;
grant select on public.stat_imports to anon, authenticated;
grant insert, delete on public.stat_imports to authenticated;
revoke all on public.season_stats from anon, authenticated;
grant select on public.season_stats to anon, authenticated;

revoke all on function public.stat_imports_same_team() from public, anon, authenticated;
revoke all on function public.import_season_stats(uuid, jsonb) from public, anon;
grant execute on function public.import_season_stats(uuid, jsonb) to authenticated;
