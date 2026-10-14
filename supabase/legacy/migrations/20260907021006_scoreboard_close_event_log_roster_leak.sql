-- SEC-1. The undo log was world-readable and every row held a full games-row
-- snapshot, `lineups` included -- so the rosters moved into scoreboard.rosters
-- for privacy were still readable by anyone with the publishable key, with no
-- game id needed. Nothing in the app ever SELECTs this table (control.js only
-- deletes from it; apply_event/undo are SECURITY INVOKER and read it as the
-- owner), so the public read policy bought nothing.

-- 1. Owner-only reads. undo() runs as the invoker and events.owner_id defaults
--    to auth.uid(), and only the owner can update a game, so the owner always
--    sees their own history. (select auth.uid()) so it evaluates once, not per row.
alter policy events_read on scoreboard.events
  using (owner_id = (select auth.uid()));

-- 2. Stop writing the roster into new snapshots. undo() restores an explicit
--    column list that has never included `lineups`, so dropping the key from
--    prev_state cannot affect undo.
create or replace function scoreboard.apply_event(
  p_game uuid, p_type text, p_new jsonb, p_payload jsonb default '{}'::jsonb)
returns scoreboard.games
language plpgsql
as $$
declare prev jsonb; result scoreboard.games;
begin
  select to_jsonb(g.*) - 'lineups' into prev from scoreboard.games g where g.id = p_game;
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
  return result;
end;
$$;

-- 3. Scrub the rosters already sitting in history.
update scoreboard.events
   set prev_state = prev_state - 'lineups'
 where prev_state ? 'lineups';
