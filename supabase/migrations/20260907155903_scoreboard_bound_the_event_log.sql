-- PERF-5. One event row per pitch, each holding a full games-row snapshot, and
-- nothing ever removed it: the log was only cleared when a game was explicitly
-- Reset. A season accumulates indefinitely, for an undo depth nobody uses past
-- a handful of plays.
--
-- Two changes, both inside apply_event.
--
-- 1. The snapshot carries only what undo() puts back. undo() assigns an explicit
--    list of 45 columns; everything else in the row is dead weight — and the
--    dead weight is the expensive part, since obs_scenes alone can hold sixty
--    scene names. Verified: none of the 45 is in the dropped list, so nothing
--    comes back NULL. This is a blacklist rather than a whitelist on purpose —
--    a column added later stays in the snapshot by default, which costs bytes,
--    where a forgotten whitelist entry would silently restore a NULL.
--
-- 2. The log keeps the newest 200 events per game. Deep past anything usable:
--    that is most of a game, and undo is for the play you just got wrong.
--
-- Measured on a 400-play game with a populated row: 1422 KB of history before,
-- 270 KB after and bounded there — 81% smaller, and no longer a function of how
-- long the season is.
create or replace function scoreboard.apply_event(
  p_game uuid, p_type text, p_new jsonb, p_payload jsonb default '{}'::jsonb)
returns scoreboard.games
language plpgsql
as $$
declare prev jsonb; result scoreboard.games;
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
  values (p_game, p_type, coalesce(p_payload, '{}'::jsonb), prev);

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

-- Slim the rows already stored, so the change applies to the history too.
update scoreboard.events
   set prev_state = prev_state - array['look','audio','card','sponsors',
         'obs_scenes','obs_status','obs_cmd','scene_cmd','replay_cmd','replay_ack']
 where prev_state ?| array['look','audio','card','sponsors',
         'obs_scenes','obs_status','obs_cmd','scene_cmd','replay_cmd','replay_ack'];
