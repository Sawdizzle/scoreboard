-- =============================================================================
-- Extras 1 — other sports, score only.
-- =============================================================================
-- Scoreboard also scores football, soccer, basketball and volleyball. Here a
-- game gains a sport. Baseball is everything built so far (lineups, the pad,
-- stats). The others are score only: the score, the period (quarter, half,
-- set), and for volleyball the sets won. They go through the same apply_play
-- and undo_play, with no stat rows, and keep their state in live.state.
-- A game's sport is set when it is made and does not change.
-- =============================================================================

alter table public.games
  add column sport text not null default 'baseball'
    check (sport in ('baseball', 'football', 'soccer', 'basketball', 'volleyball'));

grant insert (sport) on public.games to authenticated;
