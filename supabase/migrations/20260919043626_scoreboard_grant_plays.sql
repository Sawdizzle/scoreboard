-- The plays table (v3.61) shipped with RLS policies but no table grants, so
-- apply_event and undo -- both SECURITY INVOKER, running as the signed-in
-- owner -- hit "permission denied for table plays". Undo failed outright, and
-- any play carrying a play-by-play row was rejected. The policies already
-- limit rows to the owner; these grants let those policies apply.
grant select, insert, delete on scoreboard.plays to authenticated;
