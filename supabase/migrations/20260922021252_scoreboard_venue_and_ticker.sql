-- Venue (for the weather on Starting Soon and the pause card) and the scrolling
-- announcement ticker. Both are presentation settings written directly by the
-- pad, like card and sponsors, so neither goes through apply_event or undo.
alter table scoreboard.games
  add column if not exists venue  jsonb,
  add column if not exists ticker jsonb;
comment on column scoreboard.games.venue is 'Where the game is played, for the weather on Starting Soon and the pause card: {label, query, lat, lon, tz}. lat/lon are rounded to 2 decimals (~1 km). Written directly via setup, not apply_event.';
comment on column scoreboard.games.ticker is 'Scrolling announcement strip: {text, tone, on, nonce}. Persistent until hidden. Written directly, not apply_event.';
