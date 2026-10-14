-- SEC-4. The signup endpoint is verify_jwt=false with CORS *, and had no rate
-- limit, no captcha and no counter: a free account-creation endpoint for anyone
-- who found it. This gives it a memory. Written and read only by the edge
-- function under the service role — no policy, so PostgREST cannot reach it.
create table if not exists scoreboard.signup_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now(),
  ok boolean not null default false
);
alter table scoreboard.signup_attempts enable row level security;
revoke all on scoreboard.signup_attempts from anon, authenticated;

create index if not exists signup_attempts_ip_idx on scoreboard.signup_attempts (ip, at desc);

comment on table scoreboard.signup_attempts is
  'Rate-limit ledger for the public signup edge function. Service role only: RLS is on with no policy, so anon and authenticated cannot read or write it even though the schema is exposed.';

-- Count an address in and say whether it has had enough. One round trip, so the
-- function stays a single request. Kept short: this is a hobby app for one
-- operator per account, not a service with a signup funnel.
create or replace function scoreboard.note_signup_attempt(p_ip text, p_limit int default 5, p_window interval default '1 hour')
returns int
language plpgsql
security definer
set search_path = scoreboard, pg_temp
as $$
declare n int;
begin
  delete from scoreboard.signup_attempts where at < now() - interval '7 days';
  insert into scoreboard.signup_attempts (ip) values (coalesce(nullif(p_ip, ''), 'unknown'));
  select count(*) into n from scoreboard.signup_attempts
   where ip = coalesce(nullif(p_ip, ''), 'unknown') and at > now() - p_window;
  return n;
end;
$$;
revoke all on function scoreboard.note_signup_attempt(text, int, interval) from public, anon, authenticated;

-- The service role is the only caller, and needs saying so explicitly: revoking
-- from PUBLIC takes its privilege too, since that is where it came from. It also
-- had no USAGE on this schema at all — nothing had ever reached in as the
-- service role before, because the pad and the overlay arrive through PostgREST
-- as anon/authenticated.
grant usage on schema scoreboard to service_role;
grant execute on function scoreboard.note_signup_attempt(text, int, interval) to service_role;
grant select, insert, delete on scoreboard.signup_attempts to service_role;
