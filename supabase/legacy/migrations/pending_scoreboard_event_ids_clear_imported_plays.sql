-- plays is keyed by event_id, and a database restored from another project can
-- hold plays whose event ids are ahead of this one's events.id counter. Each
-- new event that landed on one of those ids failed apply_event with
-- "duplicate key value violates unique constraint plays_pkey": the play rolled
-- back and the pad saved it on the retry, four seconds late.
--
-- Move the counter past every play already here. Never backwards, and nothing
-- to do on a database with no plays.
do $$
declare hi bigint; seq text := pg_get_serial_sequence('scoreboard.events', 'id');
begin
  select max(event_id) into hi from scoreboard.plays;
  if hi is not null then
    perform setval(seq, greatest(hi, nextval(seq)));
  end if;
end $$;

-- Undo removes the play its event wrote. By event id alone that could be
-- another game's play wearing the same id, so it is this game's play only.
create or replace function scoreboard.undo(p_game uuid)
returns scoreboard.games
language plpgsql
set search_path = scoreboard, pg_temp
as $$
declare ev scoreboard.events; result scoreboard.games; back jsonb;
begin
  select * into ev from scoreboard.events where game_id = p_game and not undone order by id desc limit 1;
  if ev.id is null then select * into result from scoreboard.games where id = p_game; return result; end if;

  if jsonb_typeof(ev.payload -> 'writes') = 'array' then
    -- The row as it stands, with only this event's columns put back.
    select to_jsonb(g.*) || coalesce((
             select jsonb_object_agg(k, ev.prev_state -> k)
               from jsonb_array_elements_text(ev.payload -> 'writes') k
              where ev.prev_state ? k), '{}'::jsonb)
      into back
      from scoreboard.games g where g.id = p_game;
  else
    back := ev.prev_state;   -- an event from before 'writes': the old, whole-row undo
  end if;

  update scoreboard.games g set
    (status, home_name, away_name, home_abbr, away_abbr, home_logo_url, away_logo_url,
     home_color, away_color, theme, sound_pack, scorebug_position, scorebug_scale,
     time_limit_seconds, clock_running, clock_ends_at, clock_remaining_seconds,
     inning, half, balls, strikes, outs, bases,
     home_score, away_score, home_hits, away_hits, home_errors, away_errors, line_score,
     show_batter, show_pitcher, show_pitchcount, show_clock, show_runrule, run_rule_diff,
     rally_mode, current_animation, sport, style, state)
    = (select m.status, m.home_name, m.away_name, m.home_abbr, m.away_abbr, m.home_logo_url, m.away_logo_url,
              m.home_color, m.away_color, m.theme, m.sound_pack, m.scorebug_position, m.scorebug_scale,
              m.time_limit_seconds, m.clock_running, m.clock_ends_at, m.clock_remaining_seconds,
              m.inning, m.half, m.balls, m.strikes, m.outs, m.bases,
              m.home_score, m.away_score, m.home_hits, m.away_hits, m.home_errors, m.away_errors, m.line_score,
              m.show_batter, m.show_pitcher, m.show_pitchcount, m.show_clock, m.show_runrule, m.run_rule_diff,
              m.rally_mode, m.current_animation, m.sport, m.style, m.state
       from jsonb_populate_record(null::scoreboard.games, back) as m)
  where g.id = p_game
  returning * into result;

  update scoreboard.events set undone = true where id = ev.id;
  delete from scoreboard.plays where event_id = ev.id and game_id = p_game;
  return result;
end; $$;
