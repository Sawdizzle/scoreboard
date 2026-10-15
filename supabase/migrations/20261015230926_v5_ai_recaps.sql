-- =============================================================================
-- AI recaps: a written recap of a final game, and what each AI call cost.
-- =============================================================================
-- game_recaps   One per game. Claude writes it from the game's facts
--               (lib/summarize.ts), never from the raw log; staff edit it,
--               then publish it. A draft is staff only; a published recap is
--               public, like the game page it sits on.
--                 content   { headline, recap, social: { instagram, facebook,
--                             x }, website_post: { title, body_markdown },
--                             player_of_the_game: { name_or_number, reason } }
--                 facts     the GameFacts it was written from
--                 warnings  what the fact check still found after one retry
--
-- ai_usage      One row per AI call, by team, so a team's use can be counted
--               and, later, capped by plan. Staff of the team may add and read
--               their own rows.
--
-- Only organizers and coaches write recaps. Nothing here runs live: the stream
-- never reads either table.
-- =============================================================================

create table public.game_recaps (
  game_id      uuid primary key references public.games(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  status       text not null default 'draft' check (status in ('draft', 'published')),
  content      jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) < 65536),
  facts        jsonb not null check (jsonb_typeof(facts) = 'object' and pg_column_size(facts) < 131072),
  warnings     jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  model        text check (model is null or char_length(model) <= 64),
  generated_at timestamptz not null default now(),
  edited_at    timestamptz,
  published_at timestamptz,
  updated_by   uuid default auth.uid() references auth.users(id) on delete set null,
  constraint game_recaps_own_team check (team_id = public.game_team(game_id))
);
create index game_recaps_team_idx on public.game_recaps (team_id);
comment on table public.game_recaps is
  'A final game''s AI-written recap, edited and published by staff. Drafts are staff only.';

create table public.ai_usage (
  id            bigint generated always as identity primary key,
  team_id       uuid not null references public.teams(id) on delete cascade,
  game_id       uuid references public.games(id) on delete set null,
  kind          text not null check (kind in ('recap', 'blurb', 'digest')),
  model         text not null check (char_length(model) <= 64),
  input_tokens  int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  ok            boolean not null,
  created_by    uuid default auth.uid() references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index ai_usage_team_idx on public.ai_usage (team_id, created_at);
comment on table public.ai_usage is
  'One row per AI call, by team: the model, the tokens and whether it worked.';

alter table public.game_recaps enable row level security;
create policy game_recaps_read_public on public.game_recaps for select to anon
  using (status = 'published');
create policy game_recaps_read on public.game_recaps for select to authenticated
  using (status = 'published' or public.is_team_staff(team_id));
create policy game_recaps_insert on public.game_recaps for insert
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));
create policy game_recaps_update on public.game_recaps for update
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']))
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));
create policy game_recaps_delete on public.game_recaps for delete
  using (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach']));
grant select on public.game_recaps to anon, authenticated;
grant insert (game_id, team_id, status, content, facts, warnings, model, generated_at, edited_at, published_at) on public.game_recaps to authenticated;
grant update (status, content, facts, warnings, model, generated_at, edited_at, published_at, updated_by) on public.game_recaps to authenticated;
grant delete on public.game_recaps to authenticated;

alter table public.ai_usage enable row level security;
create policy ai_usage_read on public.ai_usage for select
  using (public.is_team_staff(team_id));
create policy ai_usage_insert on public.ai_usage for insert
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach'])
              and (game_id is null or public.game_team(game_id) = team_id));
grant select on public.ai_usage to authenticated;
grant insert (team_id, game_id, kind, model, input_tokens, output_tokens, ok) on public.ai_usage to authenticated;
