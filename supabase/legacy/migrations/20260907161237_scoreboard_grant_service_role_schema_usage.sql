-- The service role had no USAGE on this schema at all — the app never needed it,
-- because the pad and the overlay come through PostgREST as anon/authenticated.
-- The signup edge function is the first thing to reach in as the service role,
-- and it was failing with "permission denied for schema scoreboard", which the
-- rate limiter then swallowed by design (it fails open) and logged.
-- (Also folded into 20260907160926_scoreboard_signup_throttle.sql; this file
-- matches the remote history entry.)
grant usage on schema scoreboard to service_role;
