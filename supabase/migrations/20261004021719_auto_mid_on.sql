-- =============================================================================
-- The mid-inning board comes up by itself.
-- =============================================================================
-- Scoreboard put Mid-Inning on air at the third out without being asked, and
-- that is wanted here too: auto_mid is on unless a team turns it off in On Air.
-- Existing channels are switched on once; the switch stays theirs after that.
-- =============================================================================

alter table public.channels alter column auto_mid set default true;
update public.channels set auto_mid = true where not auto_mid;
