-- =============================================================================
-- The invite-code gate has no domain bypass.
-- =============================================================================
-- The gate let any address ending @users.scoreboard.app through without a
-- code, for v4's own accounts. Anyone could type such an address. v4's
-- sign-up function is retired, so the bypass goes: a sign-up needs the code
-- or an open staff invite, whatever its address.
-- =============================================================================

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
  v_meta jsonb := coalesce(event->'user'->'user_metadata', event->'user'->'raw_user_meta_data', '{}');
begin
  select value into v_code from private.settings where key = 'invite_code';
  if coalesce(v_code, '') = ''
     or v_meta->>'invite_code' = v_code
     or exists (select 1 from public.staff_invites i
                 where i.token::text = v_meta->>'staff_invite' and i.used_at is null and i.expires_at > now()) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403,
    'message', 'Sign-up needs an invite code.'));
end;
$$;
