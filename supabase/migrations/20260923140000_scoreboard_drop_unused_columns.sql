-- Applied 2026-09-23, after v4.01 reached prod (the pad before it still wrote
-- pitch_count on Reset).
--
-- Five columns nothing uses any more:
--   lineups        rosters moved to scoreboard.rosters (private) long ago
--   batter_name, batter_number, pitcher_name
--                  hand-typed fallbacks from before lineups; no writer, and the
--                  overlay stopped reading them on this branch
--   pitch_count    replaced by state.pitches (per team) and state.pitchLog (per
--                  pitcher); the pad stopped reading and writing it on this branch
-- All five were empty in every game on 2026-09-23.
--
-- apply_event and undo list their columns by name, so they are redefined
-- without these in the same transaction as the drop.

create or replace function scoreboard.apply_event(
  p_game uuid, p_type text, p_new jsonb, p_payload jsonb default '{}'::jsonb)
returns scoreboard.games
language plpgsql
set search_path = scoreboard, pg_temp
as $$
declare prev jsonb; result scoreboard.games; ev_id bigint; pl jsonb;
begin
  select to_jsonb(g.*) - array[
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
     show_batter, show_pitcher, show_pitchcount, show_clock, show_runrule, run_rule_diff,
     rally_mode, current_animation, sport, style, state)
    = (select m.status, m.home_name, m.away_name, m.home_abbr, m.away_abbr, m.home_logo_url, m.away_logo_url,
              m.home_color, m.away_color, m.theme, m.sound_pack, m.scorebug_position, m.scorebug_scale,
              m.time_limit_seconds, m.clock_running, m.clock_ends_at, m.clock_remaining_seconds,
              m.inning, m.half, m.balls, m.strikes, m.outs, m.bases,
              m.home_score, m.away_score, m.home_hits, m.away_hits, m.home_errors, m.away_errors, m.line_score,
              m.show_batter, m.show_pitcher, m.show_pitchcount, m.show_clock, m.show_runrule, m.run_rule_diff,
              m.rally_mode, m.current_animation, m.sport, m.style, m.state
       from jsonb_populate_record((select gg from scoreboard.games gg where gg.id = p_game), p_new) as m)
  where g.id = p_game
  returning * into result;

  -- Which columns this event wrote, so undo puts back those and nothing else.
  insert into scoreboard.events(game_id, type, payload, prev_state)
  values (p_game, p_type,
          coalesce(p_payload, '{}'::jsonb)
            || jsonb_build_object('writes', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) k)),
          prev)
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
  delete from scoreboard.plays where event_id = ev.id;
  return result;
end; $$;


alter table scoreboard.games
  drop column lineups,
  drop column batter_name,
  drop column batter_number,
  drop column pitcher_name,
  drop column pitch_count;
