-- =============================================================================
-- AI spending cap: every reserved write counts, and only the server settles.
-- =============================================================================
-- ai_settle() was open to any signed-in user, who could mark their own rows
-- failed and so give the month's writes back: the cap refilled and spend had
-- no ceiling. Now a reserved write counts toward the month whether it worked
-- or not, and ai_settle() (tokens and outcome, for the record only) is for the
-- server's secret key alone.
-- =============================================================================

revoke execute on function public.ai_settle(bigint, text, int, int, boolean) from public, anon, authenticated;
grant execute on function public.ai_settle(bigint, text, int, int, boolean) to service_role;

create or replace function public.ai_settle(p_id bigint, p_model text, p_in int, p_out int, p_ok boolean)
returns void
language sql security definer
set search_path = public, pg_temp
as $$
  update public.ai_usage set model = left(coalesce(p_model, model), 64), input_tokens = greatest(p_in, 0),
         output_tokens = greatest(p_out, 0), ok = p_ok
   where id = p_id and created_at > now() - interval '15 minutes';
$$;

create or replace function public.ai_reserve(p_team uuid, p_game uuid, p_kind text, p_model text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int;
  v_used int;
  v_id bigint;
  v_start timestamptz := date_trunc('month', now() at time zone 'America/Chicago') at time zone 'America/Chicago';
begin
  if not public.has_team_role(p_team, array['organizer', 'head_coach', 'coach', 'scorer']) then
    raise exception 'Your seat cannot use AI writing.' using errcode = '42501';
  end if;
  if p_game is not null and public.game_team(p_game) is distinct from p_team then
    raise exception 'That game is not this team''s.' using errcode = '42501';
  end if;
  select ai_monthly_limit into v_limit from public.teams where id = p_team for update;
  select count(*) into v_used from public.ai_usage where team_id = p_team and created_at >= v_start;
  if coalesce(v_limit, 0) <= v_used then
    return jsonb_build_object('id', null, 'limit', coalesce(v_limit, 0), 'used', v_used, 'resets', v_start + interval '1 month');
  end if;
  insert into public.ai_usage (team_id, game_id, kind, model, ok) values (p_team, p_game, p_kind, p_model, true) returning id into v_id;
  return jsonb_build_object('id', v_id, 'limit', v_limit, 'used', v_used + 1, 'resets', v_start + interval '1 month');
end;
$$;

create or replace function public.ai_allowance(p_team uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int;
  v_used int;
  v_start timestamptz := date_trunc('month', now() at time zone 'America/Chicago') at time zone 'America/Chicago';
begin
  if not public.is_team_staff(p_team) then
    raise exception 'Your seat cannot see this team.' using errcode = '42501';
  end if;
  select ai_monthly_limit into v_limit from public.teams where id = p_team;
  select count(*) into v_used from public.ai_usage where team_id = p_team and created_at >= v_start;
  return jsonb_build_object('limit', coalesce(v_limit, 0), 'used', v_used,
    'remaining', greatest(coalesce(v_limit, 0) - v_used, 0),
    'resets', (v_start + interval '1 month'));
end;
$$;
