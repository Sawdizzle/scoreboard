-- =============================================================================
-- Team brand: a logo, its colours, and a display name that fits a real name.
-- =============================================================================
-- display_name  What the scorebug, the slabs and the headers show: "Blue
--               Steel", not "STEEL". Up to 24 characters; the screens size
--               the type to fit. A new team starts with its name.
-- abbr          Stays, for the tightest spots (a line-score row, a chip), at
--               up to 6. No longer what a team is known by.
-- color2        The accent: the second colour in the logo, used for the
--               stripe on a slab and the edge of a crest.
-- palette       The swatches read out of the logo, so the colour pickers can
--               offer them again later without the logo being re-read.
-- logo_url      Already there. Now points into the team-logos bucket.
--
-- Logos live in Storage, in a public bucket: a logo is shown on public pages
-- and, in Stage 3, on the stream. Each team writes only under its own folder
-- (team-logos/<team id>/...), and only its organizer or head coach.
-- =============================================================================

alter table public.teams add column display_name text;
update public.teams set display_name = left(name, 24);
alter table public.teams alter column display_name set not null;
alter table public.teams add constraint teams_display_name_len check (char_length(display_name) between 1 and 24);

alter table public.teams add column color2 text not null default '#f2f6fc'
  check (color2 ~ '^#[0-9a-fA-F]{6}$');
alter table public.teams add column palette jsonb not null default '[]'
  check (jsonb_typeof(palette) = 'array' and jsonb_array_length(palette) <= 8);
alter table public.teams add constraint teams_logo_url_https check (logo_url is null or logo_url like 'https://%');

-- A new team (create_team does not know about display names) shows its name.
create function public.teams_defaults()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.display_name is null or btrim(new.display_name) = '' then
    new.display_name := left(btrim(new.name), 24);
  end if;
  return new;
end;
$$;
create trigger teams_defaults before insert on public.teams
  for each row execute function public.teams_defaults();
revoke all on function public.teams_defaults() from public, anon, authenticated;

grant update (display_name, color2, palette) on public.teams to authenticated;

-- ------------------------------------------------------------- storage ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-logos', 'team-logos', true, 1048576, array['image/png', 'image/webp', 'image/jpeg'])
on conflict (id) do nothing;

-- The team a logo path belongs to: the first folder, when it is a uuid. CASE
-- keeps a malformed path from reaching the cast and erroring.
create function public.logo_team(p_name text)
returns uuid
language sql immutable
set search_path = public, pg_temp
as $$
  select case when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(p_name, '/', 1)::uuid end
$$;
revoke all on function public.logo_team(text) from public, anon;
grant execute on function public.logo_team(text) to authenticated;

create policy team_logos_read on storage.objects for select
  using (bucket_id = 'team-logos');
create policy team_logos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'team-logos' and public.has_team_role(public.logo_team(name), array['organizer', 'head_coach']));
create policy team_logos_update on storage.objects for update to authenticated
  using (bucket_id = 'team-logos' and public.has_team_role(public.logo_team(name), array['organizer', 'head_coach']))
  with check (bucket_id = 'team-logos' and public.has_team_role(public.logo_team(name), array['organizer', 'head_coach']));
create policy team_logos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'team-logos' and public.has_team_role(public.logo_team(name), array['organizer', 'head_coach']));

-- The invite page shows the team as it looks now: logo, colours, display
-- name. A changed return type means drop and create, with the grants again.
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
           when (select count(*) from public.team_staff s where s.team_id = i.team_id) >= 5 then 'full'
           else 'open'
         end
    from public.staff_invites i
    join public.teams t on t.id = i.team_id
   where i.token = p_token;
$$;
revoke all on function public.invite_preview(uuid) from public;
grant execute on function public.invite_preview(uuid) to anon, authenticated;
