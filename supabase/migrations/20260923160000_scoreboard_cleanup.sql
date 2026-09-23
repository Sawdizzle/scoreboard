-- Loose ends after v4.01.
--
-- 1. Saved looks are gone from the pad (v4.01: a new game starts from the last
--    one's look instead), so scoreboard.presets goes too. It held one row,
--    kept here in case it is ever wanted back:
--      name 'Default': theme nightgame, style scorebox, bottom-left at 1.25x,
--      sound pack organ, look { text #0f77ff, steel #e3e3e3 }.
-- 2. channels.game_id is a foreign key with ON DELETE SET NULL; index it so
--    deleting a game does not scan the table.
-- 3. The pad has one volume now. The audio default loses its per-category
--    levels (the overlay ignores them).

drop table scoreboard.presets;

create index channels_game_idx on scoreboard.channels using btree (game_id);

alter table scoreboard.games alter column audio set default '{"muted": false, "master": 0.8}'::jsonb;
