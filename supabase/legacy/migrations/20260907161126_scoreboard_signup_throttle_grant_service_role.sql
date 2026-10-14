-- The revoke from PUBLIC also took the service role's privilege with it, since
-- that is where it came from — so the edge function's rate-limit call failed and
-- the check was skipped. Anon and authenticated stay revoked; the service role
-- is the only caller, and needs saying so explicitly.
-- (Also folded into 20260907160926_scoreboard_signup_throttle.sql; grants are
-- idempotent, and this file matches the remote history entry.)
grant execute on function scoreboard.note_signup_attempt(text, int, interval) to service_role;
grant select, insert, delete on scoreboard.signup_attempts to service_role;
