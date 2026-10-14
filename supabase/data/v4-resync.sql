-- =============================================================================
-- Run at cutover, just before main switches to v5: v4 games that changed after
-- the first import come over again.
-- =============================================================================
-- The first import (2026-10-14-v4-games.sql) brought v4's upcoming games as
-- scheduled. v4 stayed live until the switch, so some of them were played
-- there since. A v5 copy that is still untouched (scheduled, no plays) of a v4
-- game that has moved on is removed here (its legacy_games row goes with it),
-- and running 2026-10-14-v4-games.sql again brings the game over as v4 has it
-- now, plays and all. Games made in v4 after the import come over the same way.
-- =============================================================================

delete from public.games g
 using public.legacy_games l, scoreboard.games o
 where l.game_id = g.id and o.id = l.v4_id
   and g.status = 'scheduled' and g.seq = 0
   and o.status <> 'setup';

-- Then: run supabase/data/2026-10-14-v4-games.sql again (it skips what is already mapped).
