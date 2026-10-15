-- =============================================================================
-- The public team page shows the opponent's name, colours and logo.
-- =============================================================================
-- The team page lists games with the opponent from the team's list embedded
-- (its current name, short code, colours and logo). opponents is closed to
-- anon, so for a signed-out visitor the whole games query failed with
-- "permission denied for table opponents" and the schedule came up empty.
--
-- The brand of an opponent the team has played is public already: the stream
-- (overlay_feed) and the public game page (public_game) show it. anon now
-- reads those columns, and only for an opponent on a game. The roster (other
-- clubs' players, typed in by our scorer) stays staff only.
-- =============================================================================

grant select (id, name, abbr, color, color2, logo_url) on public.opponents to anon;

-- The staff read was for every role; anon cannot run is_team_staff().
alter policy opponents_read on public.opponents to authenticated;

create policy opponents_public_brand on public.opponents for select to anon
  using (exists (select 1 from public.games g where g.opponent_id = opponents.id));
