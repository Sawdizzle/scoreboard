-- =============================================================================
-- Recaps in Spanish.
-- =============================================================================
-- game_recaps.content_es  The recap, captions and website post in Spanish, in
--                         the same shape as content. Written on request from
--                         the English as it stands; cleared when the English
--                         is edited, so the two never disagree. Shown on the
--                         public page with the English once it is published.
-- =============================================================================

alter table public.game_recaps add column content_es jsonb
  check (content_es is null or (jsonb_typeof(content_es) = 'object' and pg_column_size(content_es) < 65536));
grant insert (content_es) on public.game_recaps to authenticated;
grant update (content_es) on public.game_recaps to authenticated;
