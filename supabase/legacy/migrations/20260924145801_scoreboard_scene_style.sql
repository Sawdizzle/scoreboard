-- The overlay's full-frame scenes (Starting Soon, Mid-Inning, Final, Game
-- paused, and the smaller cards): 'simple' (the original look) or 'elevated'
-- (the Prime Time network-TV look, js/scenes-elevated.js). A presentation
-- setting like theme and style, so it rides a plain field write.
alter table scoreboard.games add column if not exists scene_style text not null default 'simple';
alter table scoreboard.games drop constraint if exists games_scene_style_check;
alter table scoreboard.games add constraint games_scene_style_check check (scene_style in ('simple', 'elevated'));
