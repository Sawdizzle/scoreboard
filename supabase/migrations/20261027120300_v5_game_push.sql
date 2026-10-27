-- =============================================================================
-- A push when a game starts and when it ends, to everyone following the team.
-- =============================================================================
-- The pad writes a game's status from the browser (apply_play), so the server
-- never sees the moment. A trigger here notes it once per game and status in
-- game_notices, and asks the app to send the push: an HTTP call through
-- pg_net to /api/push/game, with a shared secret. Both come from
-- private.settings, set once per project:
--
--   insert into private.settings (key, value) values
--     ('site_url', 'https://your-site'), ('push_hook_secret', '<PUSH_HOOK_SECRET>');
--
-- Without pg_net or those settings the note is still made and nothing is sent.
-- A game reopened and ended again is not announced twice.
-- =============================================================================

create table public.game_notices (
  game_id    uuid not null references public.games(id) on delete cascade,
  status     text not null check (status in ('live', 'final')),
  created_at timestamptz not null default now(),
  primary key (game_id, status)
);
alter table public.game_notices enable row level security;
revoke all on public.game_notices from anon, authenticated;

create function public.games_notice()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
  v_secret text;
begin
  insert into public.game_notices (game_id, status) values (new.id, new.status) on conflict do nothing;
  if not found then return new; end if;
  select value into v_url from private.settings where key = 'site_url';
  select value into v_secret from private.settings where key = 'push_hook_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = ''
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return new;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using rtrim(v_url, '/') || '/api/push/game',
          jsonb_build_object('game_id', new.id, 'status', new.status),
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret);
  return new;
exception when others then
  -- A push is never worth a failed play: the score saves regardless.
  return new;
end;
$$;
create trigger games_notice after update of status on public.games
  for each row when (new.status in ('live', 'final') and new.status is distinct from old.status)
  execute function public.games_notice();
revoke all on function public.games_notice() from public, anon, authenticated;
