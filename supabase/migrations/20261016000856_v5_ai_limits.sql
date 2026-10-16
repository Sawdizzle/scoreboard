-- =============================================================================
-- AI limits: how many AI writes a team gets each month.
-- =============================================================================
-- teams.ai_monthly_limit  AI writes (a recap, a blurb: one request each, its
--                         retry included) a team may make per calendar month.
--                         0 is AI off: the app hides the AI buttons and the
--                         routes refuse before calling anyone. Staff cannot
--                         change it (no grant): it is the plan, set by the
--                         operator of the app, and later by billing.
--
-- ai_allowance(team)      The limit, what this month has used and what is left,
--                         for the team's staff. A month is a calendar month in
--                         US Central time; only calls that worked count.
-- =============================================================================

alter table public.teams add column ai_monthly_limit int not null default 0
  check (ai_monthly_limit between 0 and 100000);
comment on column public.teams.ai_monthly_limit is
  'AI writes a team may make per calendar month; 0 turns AI off. Not writable by staff: it is the team''s plan.';

create function public.ai_allowance(p_team uuid)
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
  select count(*) into v_used from public.ai_usage where team_id = p_team and ok and created_at >= v_start;
  return jsonb_build_object('limit', coalesce(v_limit, 0), 'used', v_used,
    'remaining', greatest(coalesce(v_limit, 0) - v_used, 0),
    'resets', (v_start + interval '1 month'));
end;
$$;
revoke all on function public.ai_allowance(uuid) from public, anon;
grant execute on function public.ai_allowance(uuid) to authenticated;
