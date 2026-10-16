-- =============================================================================
-- AI kinds: the rest of the AI helpers, metered like recaps.
-- =============================================================================
-- ai_usage.kind gains: lineup (read a lineup card from a photo), schedule
-- (games from a tournament page or email), ask (a coach's stats question),
-- card (an end-of-season player card), youtube (a game video's title,
-- description and chapters) and translate (a recap in Spanish).
--
-- Scorers may now log usage too: reading the other team's lineup card is a
-- scorer's job at the field. Each route still decides who may call it.
-- =============================================================================

alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check
  check (kind in ('recap', 'blurb', 'digest', 'lineup', 'schedule', 'ask', 'card', 'youtube', 'translate'));

drop policy ai_usage_insert on public.ai_usage;
create policy ai_usage_insert on public.ai_usage for insert
  with check (public.has_team_role(team_id, array['organizer', 'head_coach', 'coach', 'scorer'])
              and (game_id is null or public.game_team(game_id) = team_id));
