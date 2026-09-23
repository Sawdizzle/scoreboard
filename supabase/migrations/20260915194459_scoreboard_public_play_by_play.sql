-- Public play-by-play for the recap page.
--
-- v3.60 records every ball in play with a name-free description in the event
-- payload: { play: { kind, pos, code, outs, runs, inning, half } }. The recap
-- page can't read that where it is:
--
--   * scoreboard.events is owner-only, and has to stay that way — prev_state is a
--     full games-row snapshot (see the events_read policy comment).
--   * the log keeps the newest 200 events per game, one per pitch, so a full
--     game loses its early innings.
--
-- So plays get a table of their own: one row per recorded play, no names, no
-- snapshot, never pruned. The recap reads it through get_plays(), the same
-- shape as get_roster(): the table itself has no public policy at all.
--
-- Names stay out by construction. A play row holds the fielding position ('SS')
-- and the scorebook code ('6-3'), never who batted or who fielded. The game id
-- is the only key, and the game row is already published (games_read).

create table scoreboard.plays (
  event_id   bigint primary key,       -- the event this play rode in on; no FK, because
                                       -- apply_event prunes old events and plays must outlive them
  game_id    uuid not null references scoreboard.games(id) on delete cascade,
  owner_id   uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  inning     smallint not null,
  half       text not null check (half in ('top', 'bottom')),
  kind       text not null check (char_length(kind) <= 4),
  pos        text check (char_length(pos) <= 2),
  code       text not null default '' check (char_length(code) <= 8),
  outs       smallint not null default 0 check (outs between 0 and 3),
  runs       smallint not null default 0 check (runs between 0 and 4)
);
create index plays_game_idx  on scoreboard.plays using btree (game_id, event_id);
create index plays_owner_idx on scoreboard.plays using btree (owner_id);

comment on table scoreboard.plays is
  'One row per recorded ball in play, for the public recap. Name-free by construction: position and scorebook code only. Written by apply_event, removed by undo, read publicly only through get_plays().';

-- Owner-only, like events. apply_event and undo are SECURITY INVOKER, so they
-- write here as the signed-in owner; Reset game deletes from the pad.
alter table scoreboard.plays enable row level security;
create policy plays_select on scoreboard.plays for select using (owner_id = (select auth.uid()));
create policy plays_insert on scoreboard.plays for insert with check (owner_id = (select auth.uid()));
create policy plays_delete on scoreboard.plays for delete using (owner_id = (select auth.uid()));

-- apply_event: unchanged except that it keeps the new event's id and, when the
-- payload carries a play, writes the play row in the same transaction.
create or replace function scoreboard.apply_event(
  p_game uuid, p_type text, p_new jsonb, p_payload jsonb default '{}'::jsonb)
returns scoreboard.games
language plpgsql
set search_path = scoreboard, pg_temp
as $$
declare prev jsonb; result scoreboard.games; ev_id bigint; pl jsonb;
begin
  select to_jsonb(g.*) - array[
           'lineups',      -- rosters are private and undo never restored them
           'look', 'audio', 'card', 'sponsors',
           'obs_scenes', 'obs_status', 'obs_cmd', 'scene_cmd',
           'replay_cmd', 'replay_ack'
         ]
    into prev
    from scoreboard.games g where g.id = p_game;
  if prev is null then raise exception 'game % not found', p_game; end if;

  update scoreboard.games g set
    (status, home_name, away_name, home_abbr, away_abbr, home_logo_url, away_logo_url,
     home_color, away_color, theme, sound_pack, scorebug_position, scorebug_scale,
     time_limit_seconds, clock_running, clock_ends_at, clock_remaining_seconds,
     inning, half, balls, strikes, outs, bases,
     home_score, away_score, home_hits, away_hits, home_errors, away_errors, line_score,
     batter_name, batter_number, pitcher_name, pitch_count,
     show_batter, show_pitcher, show_pitchcount, show_clock, show_runrule, run_rule_diff,
     rally_mode, current_animation, sport, style, state)
    = (select m.status, m.home_name, m.away_name, m.home_abbr, m.away_abbr, m.home_logo_url, m.away_logo_url,
              m.home_color, m.away_color, m.theme, m.sound_pack, m.scorebug_position, m.scorebug_scale,
              m.time_limit_seconds, m.clock_running, m.clock_ends_at, m.clock_remaining_seconds,
              m.inning, m.half, m.balls, m.strikes, m.outs, m.bases,
              m.home_score, m.away_score, m.home_hits, m.away_hits, m.home_errors, m.away_errors, m.line_score,
              m.batter_name, m.batter_number, m.pitcher_name, m.pitch_count,
              m.show_batter, m.show_pitcher, m.show_pitchcount, m.show_clock, m.show_runrule, m.run_rule_diff,
              m.rally_mode, m.current_animation, m.sport, m.style, m.state
       from jsonb_populate_record((select gg from scoreboard.games gg where gg.id = p_game), p_new) as m)
  where g.id = p_game
  returning * into result;

  insert into scoreboard.events(game_id, type, payload, prev_state)
  values (p_game, p_type, coalesce(p_payload, '{}'::jsonb), prev)
  returning id into ev_id;

  -- A ball in play also lands in the public play-by-play. The inning and half
  -- are the ones the play happened in (before a third out rolled them), which
  -- the pad sends; the pre-play row is the fallback.
  pl := p_payload -> 'play';
  if jsonb_typeof(pl) = 'object' then
    insert into scoreboard.plays (event_id, game_id, inning, half, kind, pos, code, outs, runs)
    values (ev_id, p_game,
            coalesce((pl ->> 'inning')::smallint, (prev ->> 'inning')::smallint),
            coalesce(pl ->> 'half', prev ->> 'half'),
            pl ->> 'kind',
            nullif(pl ->> 'pos', ''),
            coalesce(pl ->> 'code', ''),
            coalesce((pl ->> 'outs')::smallint, 0),
            coalesce((pl ->> 'runs')::smallint, 0));
  end if;

  -- Keep the newest 200 for this game. Uses events_game_idx (game_id, id desc),
  -- and matches nothing at all until a game passes 200 plays.
  delete from scoreboard.events e
   where e.game_id = p_game
     and e.id < (select min(id) from (
           select id from scoreboard.events
            where game_id = p_game
            order by id desc
            limit 200) keep);

  return result;
end;
$$;

-- undo: unchanged except that reversing a play takes it off the play-by-play.
create or replace function scoreboard.undo(p_game uuid)
returns scoreboard.games
language plpgsql
set search_path = scoreboard, pg_temp
as $$
declare ev scoreboard.events; result scoreboard.games;
begin
  select * into ev from scoreboard.events where game_id = p_game and not undone order by id desc limit 1;
  if ev.id is null then select * into result from scoreboard.games where id = p_game; return result; end if;

  update scoreboard.games g set
    (status, home_name, away_name, home_abbr, away_abbr, home_logo_url, away_logo_url,
     home_color, away_color, theme, sound_pack, scorebug_position, scorebug_scale,
     time_limit_seconds, clock_running, clock_ends_at, clock_remaining_seconds,
     inning, half, balls, strikes, outs, bases,
     home_score, away_score, home_hits, away_hits, home_errors, away_errors, line_score,
     batter_name, batter_number, pitcher_name, pitch_count,
     show_batter, show_pitcher, show_pitchcount, show_clock, show_runrule, run_rule_diff,
     rally_mode, current_animation, sport, style, state)
    = (select m.status, m.home_name, m.away_name, m.home_abbr, m.away_abbr, m.home_logo_url, m.away_logo_url,
              m.home_color, m.away_color, m.theme, m.sound_pack, m.scorebug_position, m.scorebug_scale,
              m.time_limit_seconds, m.clock_running, m.clock_ends_at, m.clock_remaining_seconds,
              m.inning, m.half, m.balls, m.strikes, m.outs, m.bases,
              m.home_score, m.away_score, m.home_hits, m.away_hits, m.home_errors, m.away_errors, m.line_score,
              m.batter_name, m.batter_number, m.pitcher_name, m.pitch_count,
              m.show_batter, m.show_pitcher, m.show_pitchcount, m.show_clock, m.show_runrule, m.run_rule_diff,
              m.rally_mode, m.current_animation, m.sport, m.style, m.state
       from jsonb_populate_record(null::scoreboard.games, ev.prev_state) as m)
  where g.id = p_game
  returning * into result;

  update scoreboard.events set undone = true where id = ev.id;
  delete from scoreboard.plays where event_id = ev.id;
  return result;
end; $$;

-- The public read. Same pattern as get_roster: SECURITY DEFINER with a pinned
-- path, returning only the name-free columns, oldest first.
create or replace function scoreboard.get_plays(p_game uuid)
returns table (inning smallint, half text, kind text, pos text, code text, outs smallint, runs smallint)
language sql
stable
security definer
set search_path = scoreboard, pg_temp
as $$
  select p.inning, p.half, p.kind, p.pos, p.code, p.outs, p.runs
    from scoreboard.plays p
   where p.game_id = p_game
   order by p.event_id;
$$;
revoke all on function scoreboard.get_plays(uuid) from public;
grant execute on function scoreboard.get_plays(uuid) to anon, authenticated;

-- Plays already recorded since v3.60 shipped: pull them out of the log, skipping
-- anything undone. Idempotent.
insert into scoreboard.plays (event_id, game_id, owner_id, created_at, inning, half, kind, pos, code, outs, runs)
select e.id, e.game_id, e.owner_id, e.created_at,
       coalesce((e.payload -> 'play' ->> 'inning')::smallint, (e.prev_state ->> 'inning')::smallint),
       coalesce(e.payload -> 'play' ->> 'half', e.prev_state ->> 'half'),
       e.payload -> 'play' ->> 'kind',
       nullif(e.payload -> 'play' ->> 'pos', ''),
       coalesce(e.payload -> 'play' ->> 'code', ''),
       coalesce((e.payload -> 'play' ->> 'outs')::smallint, 0),
       coalesce((e.payload -> 'play' ->> 'runs')::smallint, 0)
  from scoreboard.events e
 where jsonb_typeof(e.payload -> 'play') = 'object'
   and not e.undone
on conflict (event_id) do nothing;
