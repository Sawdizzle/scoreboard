-- One overlay link per account.
--
-- The overlay URL used to name one game (?game=<id>&t=<token>), so every new
-- game meant pasting a new link into OBS, and a source left on last week's link
-- quietly showed last week's game. Now an account has a channel: a secret token
-- that points at whichever game the pad last opened. The overlay is given the
-- channel (?ch=<token>) and asks which game that is. Old per-game links keep
-- working exactly as before.
--
-- The channel token is as secret as the roster token it hands out: anyone
-- holding it can read the lineups of the game it points at, same as today.
-- Rotating it rotates every roster token the account has, so no old link of
-- either kind survives.

create table scoreboard.channels (
  owner_id   uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  token      uuid not null unique default gen_random_uuid(),
  game_id    uuid references scoreboard.games(id) on delete set null,
  updated_at timestamptz not null default now()
);
comment on table scoreboard.channels is
  'One per account: the permanent overlay link (token) and the game it shows. Owner-only; the overlay reads it through resolve_channel().';

alter table scoreboard.channels enable row level security;
create policy channels_select on scoreboard.channels for select using (owner_id = (select auth.uid()));
create policy channels_insert on scoreboard.channels for insert with check (owner_id = (select auth.uid()));
create policy channels_update on scoreboard.channels for update
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
grant select, insert, update on scoreboard.channels to authenticated;

-- The pad: this account's channel token, creating the channel on first use.
create or replace function scoreboard.channel_token()
returns uuid
language plpgsql
security invoker
set search_path = scoreboard, pg_temp
as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into scoreboard.channels (owner_id) values (auth.uid()) on conflict (owner_id) do nothing;
  select token into v from scoreboard.channels where owner_id = auth.uid();
  return v;
end; $$;
revoke all on function scoreboard.channel_token() from public, anon;
grant execute on function scoreboard.channel_token() to authenticated;

-- The pad: point the channel at one of your own games.
create or replace function scoreboard.set_channel_game(p_game uuid)
returns void
language plpgsql
security invoker
set search_path = scoreboard, pg_temp
as $$
begin
  if not exists (select 1 from scoreboard.games where id = p_game and owner_id = auth.uid()) then
    raise exception 'not your game';
  end if;
  insert into scoreboard.channels (owner_id, game_id) values (auth.uid(), p_game)
    on conflict (owner_id) do update set game_id = excluded.game_id, updated_at = now()
    where scoreboard.channels.game_id is distinct from excluded.game_id;
end; $$;
revoke all on function scoreboard.set_channel_game(uuid) from public, anon;
grant execute on function scoreboard.set_channel_game(uuid) to authenticated;

-- The overlay (anon): which game does this link show, and the roster token for
-- it. Only a game the channel's owner owns — a channel can never hand out
-- somebody else's roster token. No row: the link is wrong or was rotated.
create or replace function scoreboard.resolve_channel(p_token uuid)
returns table (game_id uuid, token uuid)
language plpgsql
security definer
set search_path = scoreboard, pg_temp
as $$
#variable_conflict use_column
declare c scoreboard.channels;
begin
  select * into c from scoreboard.channels ch where ch.token = p_token and p_token is not null;
  if c.owner_id is null then return; end if;
  if c.game_id is null or not exists (select 1 from scoreboard.games g where g.id = c.game_id and g.owner_id = c.owner_id) then
    game_id := null; token := null; return next; return;
  end if;
  insert into scoreboard.rosters (game_id, owner_id) values (c.game_id, c.owner_id) on conflict (game_id) do nothing;
  return query select c.game_id, r.token from scoreboard.rosters r where r.game_id = c.game_id;
end; $$;
revoke all on function scoreboard.resolve_channel(uuid) from public;
grant execute on function scoreboard.resolve_channel(uuid) to anon, authenticated;

-- The pad: kill every link this account has ever handed out.
create or replace function scoreboard.rotate_channel_token()
returns uuid
language plpgsql
security invoker
set search_path = scoreboard, pg_temp
as $$
declare v uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform scoreboard.channel_token();
  update scoreboard.channels set token = gen_random_uuid(), updated_at = now()
   where owner_id = auth.uid() returning token into v;
  update scoreboard.rosters set token = gen_random_uuid() where owner_id = auth.uid();
  return v;
end; $$;
revoke all on function scoreboard.rotate_channel_token() from public, anon;
grant execute on function scoreboard.rotate_channel_token() to authenticated;
