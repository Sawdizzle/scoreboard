-- =============================================================================
-- Player names: one team-wide format.
-- =============================================================================
-- name_format   How the team's players are named on every screen: the pad,
--               the lineup, On Air, the stream and the public pages.
--                 full           Alex Raney  (the default: what showed before)
--                 initial_last   A. Raney
--                 last           Raney
--                 first          Alex
--                 first_initial  Alex R.
--
-- Each player's own public_name still decides how much of them the public
-- may see. It caps the team format on the stream and the public pages:
--   full           the team format, as chosen
--   first_initial  never more of the last name than its initial: a team
--                  format that shows it (full, initial_last, last) becomes
--                  "Alex R."; first and first_initial stand
--   number         number only, whatever the team format
-- Staff screens use the team format with no cap; they are staff only.
-- =============================================================================

alter table public.teams add column name_format text not null default 'full'
  check (name_format in ('full', 'initial_last', 'last', 'first', 'first_initial'));
comment on column public.teams.name_format is
  'How players are named everywhere: full, initial_last, last, first or first_initial. Each player''s public_name caps it on public screens.';
grant update (name_format) on public.teams to authenticated;

-- A name in a format. A part that is missing falls back to the part there is,
-- so a player with only a first name is never shown as nobody. lib/format.ts
-- formatName() is the same rule, for screens that draw it in the browser.
create function public.format_name(p_first text, p_last text, p_format text)
returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select nullif(case p_format
           when 'initial_last' then case when f <> '' and l <> '' then left(f, 1) || '. ' || l else btrim(f || ' ' || l) end
           when 'last' then coalesce(nullif(l, ''), f)
           when 'first' then coalesce(nullif(f, ''), l)
           when 'first_initial' then btrim(f || ' ' || case when l <> '' then left(l, 1) || '.' else '' end)
           else btrim(f || ' ' || l)
         end, '')
    from (select btrim(coalesce(p_first, '')) as f, btrim(coalesce(p_last, '')) as l) n;
$$;

-- A player's name as the public may see it: the team's format, capped by the
-- player's own setting. Now reads the team, so stable rather than immutable.
create or replace function public.player_public_name(p public.players)
returns text
language sql stable
set search_path = public, pg_temp
as $$
  select case p.public_name
           when 'number' then null
           when 'first_initial' then public.format_name(p.first_name, p.last_name,
                  case when t.name_format in ('first', 'first_initial') then t.name_format else 'first_initial' end)
           else public.format_name(p.first_name, p.last_name, coalesce(t.name_format, 'full'))
         end
    from (select (select name_format from public.teams where id = p.team_id) as name_format) t;
$$;

-- The public roster, by the same rule (it had its own copy of the old one).
create or replace function public.public_roster(p_team uuid)
returns table (id uuid, number text, display_name text, positions text[], bats text, throws text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, p.number, public.player_public_name(p), p.positions, p.bats, p.throws
    from public.players p
   where p.team_id = p_team and p.active
   order by nullif(p.number, '')::int nulls last, p.last_name, p.first_name;
$$;

revoke all on function public.format_name(text, text, text) from public, anon, authenticated;
