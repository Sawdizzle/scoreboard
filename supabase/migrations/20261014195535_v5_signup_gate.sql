-- =============================================================================
-- An optional invite code for new accounts.
-- =============================================================================
-- v4's signup function could require an invite code, so a Scoreboard meant for
-- one team was not open to anyone who found it. v5 signs up through Supabase
-- Auth directly, so the gate moves into the database: a "before user created"
-- auth hook that refuses a new account unless one of these holds:
--
--   - no code is set (the default: anyone may sign up);
--   - the sign-up carries the code (user_metadata.invite_code);
--   - the sign-up is on its way to accept an open staff invite
--     (user_metadata.staff_invite), which is a pass in itself;
--   - the address is a v4 account (@users.scoreboard.app), made by v4's own
--     signup function, which checks its own code.
--
-- The code lives in private.settings, in a schema the Data API does not
-- expose. Set it with:
--   insert into private.settings (key, value) values ('invite_code', '...')
--   on conflict (key) do update set value = excluded.value;
-- and clear it by deleting the row. The hook only runs once it is switched on
-- in the dashboard: Authentication -> Hooks -> Before User Created ->
-- Postgres function public.hook_before_user_created.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;

create table private.settings (
  key   text primary key,
  value text
);
comment on table private.settings is 'App settings kept out of the Data API. invite_code: required to sign up when set.';

-- The sign-up page asks for the code only when there is one.
create function public.signup_needs_code()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select exists (select 1 from private.settings where key = 'invite_code' and coalesce(value, '') <> '') $$;
revoke all on function public.signup_needs_code() from public;
grant execute on function public.signup_needs_code() to anon, authenticated;

create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_meta jsonb := coalesce(event->'user'->'user_metadata', event->'user'->'raw_user_meta_data', '{}');
  v_email text := lower(coalesce(event->'user'->>'email', ''));
begin
  select value into v_code from private.settings where key = 'invite_code';
  if coalesce(v_code, '') = ''
     or v_email like '%@users.scoreboard.app'
     or v_meta->>'invite_code' = v_code
     or exists (select 1 from public.staff_invites i
                 where i.token::text = v_meta->>'staff_invite' and i.used_at is null and i.expires_at > now()) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'Sign-up needs an invite code.'));
end;
$$;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

-- Supabase Auth calls the hook as supabase_auth_admin. (The role exists on a
-- Supabase project, not in the test database, hence the check.)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
  end if;
end;
$$;
